-- Stop informational broadcasts without changing recorded delivery outcomes.
alter table vehicle_trip_notifications drop constraint vehicle_trip_notifications_status_check;
alter table vehicle_trip_notifications add constraint vehicle_trip_notifications_status_check
  check(status in ('pending','accepted','sent','unknown','failed','suppressed'));
update dispatch_notifications set status='suppressed',error='',retryable=false,
  next_attempt_at=null,locked_until=null,lease_id=null,updated_at=now()
  where kind='检验项目待定' and status='pending';
update vehicle_trip_notifications n set status='suppressed',error='',retryable=false,
  next_attempt_at=null,locked_until=null,lease_id=null
  from vehicle_trip_notification_jobs j where n.job_id=j.id and j.action='return' and n.status='pending';
update vehicle_trip_notification_jobs set status='obsolete',error='',next_attempt_at=null,locked_until=null,lease_id=null
  where action='return' and status in ('pending','failed');
