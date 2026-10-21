-- Existing signed orders stay approved; new signatures explicitly await staff review.
alter table work_orders add column customer_signature_review jsonb;
alter table work_orders add constraint customer_signature_review_state
  check (customer_signature_review is null or customer_signature_review->>'state' in ('pending','confirmed'));
create unique index customer_signature_notification_recipient
  on dispatch_notifications(order_id,recipient_id,kind) where kind='需确认用户签字';
