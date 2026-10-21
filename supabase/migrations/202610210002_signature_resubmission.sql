-- Keep explicitly invalidated/expired legacy links invalid. Active links no longer expire.
update signature_tokens set expires_at=null where not used and expires_at>clock_timestamp();
-- Each signature submission must notify its advisor, including subsequent resubmissions.
drop index customer_signature_notification_recipient;
create unique index customer_signature_notification_submission
  on dispatch_notifications(order_id,recipient_id,kind,(payload->>'signedAt')) where kind='需确认用户签字';
