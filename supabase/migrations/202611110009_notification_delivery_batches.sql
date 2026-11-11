create table notification_delivery_batches (
 id uuid primary key, source text not null check(source in ('dispatch','procurement','vehicle-trip')),
 created_at timestamptz not null default now(), status text not null default 'unknown',
 task_id text, lease_id uuid, locked_until timestamptz, result_queried_at timestamptz,
 message_hash text not null
);
create table notification_delivery_batch_members (
 batch_id uuid not null references notification_delivery_batches(id), notification_id text not null,
 recipient_id text not null, recipient_name text not null, delivery_user_id text not null,
 primary key(batch_id,notification_id)
);
alter table notification_delivery_batches enable row level security;
alter table notification_delivery_batch_members enable row level security;
alter table dispatch_notifications add column delivery_batch_id uuid references notification_delivery_batches(id);
alter table procurement_notifications add column delivery_batch_id uuid references notification_delivery_batches(id);
alter table vehicle_trip_notifications add column delivery_batch_id uuid references notification_delivery_batches(id);
create index dispatch_notification_batch on dispatch_notifications(delivery_batch_id) where delivery_batch_id is not null;
create index procurement_notification_batch on procurement_notifications(delivery_batch_id) where delivery_batch_id is not null;
create index trip_notification_batch on vehicle_trip_notifications(delivery_batch_id) where delivery_batch_id is not null;
alter table notification_call_traces add column delivery_batch_id uuid references notification_delivery_batches(id);
alter table notification_call_traces add column recipient_count integer not null default 1;
