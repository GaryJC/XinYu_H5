alter table work_orders
  add column if not exists legacy_sync_revision bigint not null default 0,
  add column if not exists legacy_sync_error text;

alter table work_orders
  drop constraint if exists work_orders_legacy_sync_status_check;

alter table work_orders
  add constraint work_orders_legacy_sync_status_check
  check (legacy_sync_status in ('not_applicable', 'pending', 'processing', 'synced', 'failed'));

create table if not exists legacy_sync_outbox (
  event_id text primary key,
  order_id text not null references work_orders(id) on delete cascade,
  revision bigint not null check (revision > 0),
  event_type text not null check (event_type in ('created', 'updated', 'cancelled')),
  payload_version integer not null default 1 check (payload_version > 0),
  payload jsonb not null,
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'synced', 'failed')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  available_at timestamptz not null default now(),
  locked_by text,
  locked_at timestamptz,
  legacy_reid bigint,
  legacy_document_no integer,
  legacy_dispatch_no text,
  acknowledged_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (order_id, revision),
  check (
    status <> 'synced'
    or (
      legacy_reid is not null
      and legacy_document_no is not null
      and legacy_dispatch_no ~ '^A[0-9]+$'
    )
  )
);

create index if not exists idx_legacy_sync_outbox_poll
  on legacy_sync_outbox(status, available_at, created_at);

create index if not exists idx_legacy_sync_outbox_order_revision
  on legacy_sync_outbox(order_id, revision desc);

create or replace function touch_legacy_sync_outbox()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  if new.status = 'synced' and new.acknowledged_at is null then
    new.acknowledged_at = now();
  end if;
  return new;
end
$$;

drop trigger if exists trg_touch_legacy_sync_outbox on legacy_sync_outbox;
create trigger trg_touch_legacy_sync_outbox
before update on legacy_sync_outbox
for each row execute function touch_legacy_sync_outbox();

create or replace function apply_legacy_sync_outbox_result()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'processing' then
    update work_orders
    set
      legacy_sync_status = case
        when legacy_sync_revision = new.revision then 'processing'
        else legacy_sync_status
      end,
      legacy_sync_error = case
        when legacy_sync_revision = new.revision then null
        else legacy_sync_error
      end
    where id = new.order_id;
  elsif new.status = 'synced' then
    update work_orders
    set
      legacy_reid = coalesce(new.legacy_reid, legacy_reid),
      legacy_document_no = coalesce(new.legacy_document_no, legacy_document_no),
      dispatch_no = coalesce(nullif(new.legacy_dispatch_no, ''), dispatch_no),
      legacy_sync_status = case
        when legacy_sync_revision = new.revision then 'synced'
        else legacy_sync_status
      end,
      legacy_synced_at = case
        when legacy_sync_revision = new.revision then new.acknowledged_at
        else legacy_synced_at
      end,
      legacy_sync_error = case
        when legacy_sync_revision = new.revision then null
        else legacy_sync_error
      end
    where id = new.order_id;
  elsif new.status = 'failed' then
    update work_orders
    set
      legacy_sync_status = case
        when legacy_sync_revision = new.revision then 'failed'
        else legacy_sync_status
      end,
      legacy_sync_error = case
        when legacy_sync_revision = new.revision then new.last_error
        else legacy_sync_error
      end
    where id = new.order_id;
  end if;
  return new;
end
$$;

drop trigger if exists trg_apply_legacy_sync_outbox_result on legacy_sync_outbox;
create trigger trg_apply_legacy_sync_outbox_result
after update on legacy_sync_outbox
for each row
when (old.status is distinct from new.status)
execute function apply_legacy_sync_outbox_result();

create or replace function claim_legacy_sync_events(
  consumer_id text,
  batch_size integer default 20
)
returns setof legacy_sync_outbox
language plpgsql
security definer
set search_path = public
as $$
begin
  if nullif(btrim(consumer_id), '') is null then
    raise exception 'consumer_id is required';
  end if;

  return query
  with candidates as (
    select candidate.event_id
    from legacy_sync_outbox candidate
    where candidate.status in ('pending', 'failed')
      and candidate.available_at <= now()
      and not exists (
        select 1
        from legacy_sync_outbox earlier
        where earlier.order_id = candidate.order_id
          and earlier.revision < candidate.revision
          and earlier.status <> 'synced'
      )
    order by candidate.created_at, candidate.event_id
    for update skip locked
    limit least(greatest(batch_size, 1), 100)
  )
  update legacy_sync_outbox event
  set
    status = 'processing',
    locked_by = btrim(consumer_id),
    locked_at = now(),
    attempt_count = event.attempt_count + 1,
    last_error = null,
    legacy_reid = coalesce(event.legacy_reid, work_order.legacy_reid),
    legacy_document_no = coalesce(event.legacy_document_no, work_order.legacy_document_no),
    legacy_dispatch_no = coalesce(event.legacy_dispatch_no, nullif(work_order.dispatch_no, ''))
  from work_orders work_order
  where event.event_id in (select event_id from candidates)
    and work_order.id = event.order_id
  returning event.*;
end
$$;

create or replace function acknowledge_legacy_sync_event(
  target_event_id text,
  consumer_id text,
  target_legacy_reid bigint,
  target_legacy_document_no integer,
  target_legacy_dispatch_no text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  affected integer;
begin
  update legacy_sync_outbox
  set
    status = 'synced',
    legacy_reid = target_legacy_reid,
    legacy_document_no = target_legacy_document_no,
    legacy_dispatch_no = upper(btrim(target_legacy_dispatch_no)),
    acknowledged_at = now(),
    last_error = null
  where event_id = target_event_id
    and status = 'processing'
    and locked_by = btrim(consumer_id);

  get diagnostics affected = row_count;
  return affected = 1;
end
$$;

create or replace function fail_legacy_sync_event(
  target_event_id text,
  consumer_id text,
  error_message text,
  retry_after_seconds integer default 60
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  affected integer;
begin
  update legacy_sync_outbox
  set
    status = 'failed',
    last_error = left(coalesce(error_message, 'unknown legacy sync error'), 2000),
    available_at = now() + make_interval(secs => greatest(retry_after_seconds, 0))
  where event_id = target_event_id
    and status = 'processing'
    and locked_by = btrim(consumer_id);

  get diagnostics affected = row_count;
  return affected = 1;
end
$$;

create or replace function retry_legacy_sync_event(target_event_id text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  affected integer;
begin
  update legacy_sync_outbox
  set
    status = 'pending',
    locked_by = null,
    locked_at = null,
    available_at = now()
  where event_id = target_event_id
    and status = 'failed';

  get diagnostics affected = row_count;
  return affected = 1;
end
$$;

revoke all on legacy_sync_outbox from public;
revoke all on function claim_legacy_sync_events(text, integer) from public;
revoke all on function acknowledge_legacy_sync_event(text, text, bigint, integer, text) from public;
revoke all on function fail_legacy_sync_event(text, text, text, integer) from public;
revoke all on function retry_legacy_sync_event(text) from public;
