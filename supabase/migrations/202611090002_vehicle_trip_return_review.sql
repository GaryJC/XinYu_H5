-- New applications depart immediately. Existing requests retain their recorded state.
alter table vehicle_trip_requests drop constraint vehicle_trip_requests_status_check;
alter table vehicle_trip_requests add constraint vehicle_trip_requests_status_check
  check (status in ('待审批','待出车','用车中','待收车审核','已还车','已驳回','已取消'));
alter table vehicle_trip_requests
  add column return_round integer not null default 1 check (return_round > 0),
  add column return_reviewed_by text references users(id),
  add column return_reviewed_name text,
  add column return_reviewed_at timestamptz,
  add column return_rejection_reason text,
  add constraint vehicle_trip_return_no_self_review check (return_reviewed_by is null or return_reviewed_by <> applicant_id);
alter table vehicle_trip_attachments add column return_round integer not null default 1 check (return_round > 0);
create index vehicle_trip_vehicle_occupied on vehicle_trip_requests(vehicle_id)
  where status in ('用车中','待收车审核');
alter table vehicle_trip_notification_jobs drop constraint vehicle_trip_notification_jobs_action_check;
alter table vehicle_trip_notification_jobs add constraint vehicle_trip_notification_jobs_action_check
  check (action in ('create','approve','reject','cancel','depart','return','approve-return','reject-return'));
