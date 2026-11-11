-- Keep notification history and paper-order recipient read grants while opting
-- out of delivery. Never relabel accepted/unknown/sent/failed delivery results.
alter table dispatch_notifications drop constraint dispatch_notifications_status_check;
alter table dispatch_notifications add constraint dispatch_notifications_status_check
  check(status in ('pending','accepted','sent','failed','unknown','suppressed'));
alter table dispatch_scheduler_notifications drop constraint dispatch_scheduler_notifications_status_check;
alter table dispatch_scheduler_notifications add constraint dispatch_scheduler_notifications_status_check
  check(status in ('pending','ready','failed','suppressed'));
alter table vehicle_license_exceptions drop constraint vehicle_license_exceptions_status_check;
alter table vehicle_license_exceptions add constraint vehicle_license_exceptions_status_check
  check(status in ('pending','queued','failed','suppressed'));
alter table vehicle_license_exceptions alter column status set default 'suppressed';
alter table vehicle_license_exception_notifications drop constraint vehicle_license_exception_notifications_status_check;
alter table vehicle_license_exception_notifications add constraint vehicle_license_exception_notifications_status_check
  check(status in ('pending','accepted','sent','failed','unknown','suppressed'));

update dispatch_notifications set status='suppressed',error='',retryable=false,
  next_attempt_at=null,locked_until=null,lease_id=null,updated_at=now()
  where kind in ('纸质委托书已创建','维修暂停') and status='pending';
update dispatch_scheduler_notifications set status='suppressed',error='',
  next_attempt_at=null,locked_until=null,lease_id=null,updated_at=now()
  where kind='维修暂停' and status in ('pending','failed');
update vehicle_license_exception_notifications set status='suppressed',error='',retryable=false,
  next_attempt_at=null,locked_until=null,lease_id=null where status='pending';
update vehicle_license_exceptions set status='suppressed',error='',
  next_attempt_at=null,locked_until=null,lease_id=null where status in ('pending','failed');
