create or replace function acknowledge_legacy_sync_events(
  consumer_id text,
  results jsonb
)
returns table(event_id text, acknowledged boolean)
language plpgsql
security definer
set search_path = public
as $$
begin
  if nullif(btrim(consumer_id), '') is null then
    raise exception 'consumer_id is required';
  end if;
  if jsonb_typeof(results) is distinct from 'array' then
    raise exception 'results must be a JSON array';
  end if;
  if jsonb_array_length(results) > 100 then
    raise exception 'a batch may contain at most 100 results';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(results) item
    where nullif(btrim(item->>'event_id'), '') is null
      or nullif(btrim(item->>'legacy_reid'), '') is null
      or nullif(btrim(item->>'legacy_document_no'), '') is null
      or nullif(btrim(item->>'legacy_dispatch_no'), '') is null
  ) then
    raise exception 'each result requires event_id, legacy_reid, legacy_document_no and legacy_dispatch_no';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(results) item
    group by btrim(item->>'event_id')
    having count(*) > 1
  ) then
    raise exception 'results contains duplicate event_id values';
  end if;

  return query
  with parsed as materialized (
    select
      item.ordinality,
      btrim(item.value->>'event_id') as input_event_id,
      (item.value->>'legacy_reid')::bigint as input_legacy_reid,
      (item.value->>'legacy_document_no')::integer as input_legacy_document_no,
      upper(btrim(item.value->>'legacy_dispatch_no')) as input_legacy_dispatch_no
    from jsonb_array_elements(results) with ordinality as item(value, ordinality)
  ),
  updated as (
    update legacy_sync_outbox event
    set
      status = 'synced',
      legacy_reid = parsed.input_legacy_reid,
      legacy_document_no = parsed.input_legacy_document_no,
      legacy_dispatch_no = parsed.input_legacy_dispatch_no,
      acknowledged_at = now(),
      last_error = null
    from parsed
    where event.event_id = parsed.input_event_id
      and event.status = 'processing'
      and event.locked_by = btrim(consumer_id)
    returning event.event_id
  )
  select
    parsed.input_event_id,
    updated.event_id is not null
  from parsed
  left join updated on updated.event_id = parsed.input_event_id
  order by parsed.ordinality;
end
$$;

create or replace function fail_legacy_sync_events(
  consumer_id text,
  failures jsonb
)
returns table(event_id text, failed boolean)
language plpgsql
security definer
set search_path = public
as $$
begin
  if nullif(btrim(consumer_id), '') is null then
    raise exception 'consumer_id is required';
  end if;
  if jsonb_typeof(failures) is distinct from 'array' then
    raise exception 'failures must be a JSON array';
  end if;
  if jsonb_array_length(failures) > 100 then
    raise exception 'a batch may contain at most 100 failures';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(failures) item
    where nullif(btrim(item->>'event_id'), '') is null
  ) then
    raise exception 'each failure requires event_id';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(failures) item
    group by btrim(item->>'event_id')
    having count(*) > 1
  ) then
    raise exception 'failures contains duplicate event_id values';
  end if;

  return query
  with parsed as materialized (
    select
      item.ordinality,
      btrim(item.value->>'event_id') as input_event_id,
      left(coalesce(item.value->>'error_message', 'unknown legacy sync error'), 2000) as input_error_message,
      greatest(coalesce((item.value->>'retry_after_seconds')::integer, 60), 0) as input_retry_after_seconds
    from jsonb_array_elements(failures) with ordinality as item(value, ordinality)
  ),
  updated as (
    update legacy_sync_outbox event
    set
      status = 'failed',
      last_error = parsed.input_error_message,
      available_at = now() + make_interval(secs => parsed.input_retry_after_seconds)
    from parsed
    where event.event_id = parsed.input_event_id
      and event.status = 'processing'
      and event.locked_by = btrim(consumer_id)
    returning event.event_id
  )
  select
    parsed.input_event_id,
    updated.event_id is not null
  from parsed
  left join updated on updated.event_id = parsed.input_event_id
  order by parsed.ordinality;
end
$$;

revoke all on function acknowledge_legacy_sync_events(text, jsonb) from public;
revoke all on function fail_legacy_sync_events(text, jsonb) from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'runfeng_sync') then
    grant execute on function acknowledge_legacy_sync_events(text, jsonb) to runfeng_sync;
    grant execute on function fail_legacy_sync_events(text, jsonb) to runfeng_sync;
  end if;
end
$$;
