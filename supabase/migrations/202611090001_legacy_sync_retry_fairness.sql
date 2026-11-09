-- Preserve total attempts and the existing consumer API across manual retry cycles.
alter table legacy_sync_outbox add column auto_attempt_count integer not null default 0
  check (auto_attempt_count >= 0);
update legacy_sync_outbox set auto_attempt_count = attempt_count
where status <> 'synced' and attempt_count > 0;

create index idx_legacy_sync_ready_fair
  on legacy_sync_outbox ((attempt_count = 0) desc, available_at, created_at, event_id)
  where status in ('pending', 'failed') and auto_attempt_count < 2;

-- Existing exhausted, unclaimed events also require explicit recovery.
update legacy_sync_outbox
set status = 'failed', available_at = 'infinity',
    locked_at = null, locked_by = null,
    last_error = left('自动拉取已暂停，请核对润丰是否已建单并修正后重试。' || coalesce(last_error, ''), 2000)
where status in ('pending', 'failed') and auto_attempt_count >= 2;

create or replace function requeue_timed_out_legacy_sync_events()
returns integer language plpgsql security definer set search_path = public as $$
declare affected integer;
begin
  with expired as (
    select event_id from legacy_sync_outbox
    where status = 'processing' and locked_at <= now() - interval '10 minutes'
    order by locked_at, event_id
    for update skip locked limit 100
  )
  update legacy_sync_outbox event
  set status = case when auto_attempt_count >= 2 then 'failed' else 'pending' end,
      locked_by = null, locked_at = null,
      available_at = case when auto_attempt_count >= 2 then 'infinity'::timestamptz
        else now() + interval '5 minutes' end,
      last_error = case when auto_attempt_count >= 2
        then '润丰连续2次领取后未回执，自动拉取已暂停；请核对是否已建单并修正后重试'
        else '润丰领取后10分钟未回执，已延后重试' end
  where event.event_id in (select event_id from expired);
  get diagnostics affected = row_count;
  return affected;
end $$;

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
      and candidate.auto_attempt_count < 2
      and not exists (
        select 1
        from legacy_sync_outbox earlier
        where earlier.order_id = candidate.order_id
          and earlier.revision < candidate.revision
          and earlier.status <> 'synced'
      )
    order by (candidate.attempt_count = 0) desc, candidate.available_at, candidate.created_at, candidate.event_id
    for update skip locked
    limit least(greatest(batch_size, 1), 100)
  )
  update legacy_sync_outbox event
  set
    status = 'processing',
    locked_by = btrim(consumer_id),
    locked_at = now(),
    attempt_count = event.attempt_count + 1,
    auto_attempt_count = event.auto_attempt_count + 1,
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

create or replace function fail_legacy_sync_event(
  target_event_id text, consumer_id text, error_message text, retry_after_seconds integer default 60
) returns boolean language plpgsql security definer set search_path = public as $$
declare affected integer;
begin
  update legacy_sync_outbox
  set status = 'failed', locked_by = null, locked_at = null,
      last_error = left(case when auto_attempt_count >= 2 then '自动拉取已暂停，请核对并修正后重试。' else '' end
        || coalesce(nullif(error_message, ''), '润丰同步失败，未提供原因'), 2000),
      available_at = case when auto_attempt_count >= 2 then 'infinity'::timestamptz
        else now() + make_interval(secs => greatest(coalesce(retry_after_seconds, 60),
          300)) end
  where event_id = target_event_id and status = 'processing' and locked_by = btrim(consumer_id);
  get diagnostics affected = row_count;
  return affected = 1;
end $$;

-- Reuse event identity, revision, payload and total count. Never interrupt an active claim.
create or replace function retry_legacy_sync_event(target_event_id text)
returns boolean language plpgsql security definer set search_path = public as $$
declare affected integer;
begin
  update legacy_sync_outbox
  set status = 'pending', auto_attempt_count = 0, locked_by = null, locked_at = null,
      available_at = now(), last_error = null
  where event_id = target_event_id and status = 'failed';
  get diagnostics affected = row_count;
  return affected = 1;
end $$;
