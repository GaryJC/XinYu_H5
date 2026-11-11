-- Capture actual delivery targets for explicit, on-demand result checks.
-- Existing rows are intentionally not backfilled from mutable user bindings.
alter table dispatch_notifications
  add column delivery_user_id text,
  add column delivery_submitted_at timestamptz,
  add column result_queried_at timestamptz;
alter table procurement_notifications
  add column delivery_user_id text,
  add column delivery_submitted_at timestamptz,
  add column result_queried_at timestamptz;
alter table vehicle_trip_notifications
  add column delivery_user_id text,
  add column delivery_submitted_at timestamptz,
  add column result_queried_at timestamptz;
alter table vehicle_license_exception_notifications
  add column delivery_user_id text,
  add column delivery_submitted_at timestamptz,
  add column result_queried_at timestamptz;
alter table vehicle_insurance_notifications
  add column delivery_user_id text,
  add column delivery_submitted_at timestamptz,
  add column result_queried_at timestamptz;

-- Accepted/unknown rows are no longer background work, including pre-upgrade rows.
create index dispatch_notifications_pending_delivery on dispatch_notifications(next_attempt_at,id) where status='pending';
create index procurement_notifications_pending_delivery on procurement_notifications(created_at,id) where status='pending';
create index vehicle_trip_notifications_pending_delivery on vehicle_trip_notifications(created_at,id) where status='pending';
create index vehicle_license_notifications_pending_delivery on vehicle_license_exception_notifications(created_at,id) where status='pending';
create index vehicle_insurance_notifications_pending_delivery on vehicle_insurance_notifications(next_attempt_at,id) where status='pending';
