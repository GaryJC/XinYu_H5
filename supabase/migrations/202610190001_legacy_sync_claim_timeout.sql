-- Recover abandoned claims without changing their immutable event identity or revision.
create index if not exists idx_legacy_sync_outbox_processing_timeout
  on legacy_sync_outbox(locked_at) where status = 'processing';

create or replace function requeue_timed_out_legacy_sync_events()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  affected integer;
begin
  with expired as (
    select event_id
    from legacy_sync_outbox
    where status = 'processing'
      and locked_at <= now() - interval '10 minutes'
    order by locked_at, event_id
    for update skip locked
  )
  update legacy_sync_outbox event
  set status = 'pending', locked_by = null, locked_at = null,
      available_at = now(), last_error = null
  where event.event_id in (select event_id from expired);
  get diagnostics affected = row_count;
  return affected;
end
$$;

revoke all on function requeue_timed_out_legacy_sync_events() from public;

create or replace function apply_legacy_sync_outbox_result()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'pending' then
    update work_orders
    set legacy_sync_status = 'pending', legacy_sync_error = null
    where id = new.order_id and legacy_sync_revision = new.revision;
  elsif new.status = 'processing' then
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

  perform requeue_timed_out_legacy_sync_events();

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
