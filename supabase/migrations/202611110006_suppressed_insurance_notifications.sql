-- Preserve actual delivery history; stop only unsent insurance reminders.
update vehicle_insurance_notifications set status='suppressed',error='',retryable=false,
 next_attempt_at=null,locked_until=null,lease_id=null where status='pending';
