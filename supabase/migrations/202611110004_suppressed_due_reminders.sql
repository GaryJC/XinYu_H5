-- Retire only unsent deadline reminders; preserve actual delivery history.
update dispatch_notifications set status='suppressed',error='',retryable=false,
  next_attempt_at=null,locked_until=null,lease_id=null,updated_at=now()
  where kind='即将到期' and status='pending';
