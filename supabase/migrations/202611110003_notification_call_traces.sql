create table notification_tracking_epoch (
 id boolean primary key default true check(id), started_at timestamptz not null default now()
);
-- First real trace establishes the coverage boundary, not migration time.
create table notification_call_traces (
 id uuid primary key, started_at timestamptz not null default clock_timestamp(),
 operation text not null check(operation in ('send','query')), source text not null,
 notification_id text not null, shop_id text not null, resource_id text not null,
 event_key text not null, recipient_id text not null, recipient_name text not null, kind text not null,
 outcome text not null default 'started', http_status integer, api_code text,
 duration_ms integer, platform_task_id text
);
alter table notification_call_traces enable row level security;
alter table notification_tracking_epoch enable row level security;
create index notification_calls_shop_time on notification_call_traces(shop_id,started_at desc,id);
