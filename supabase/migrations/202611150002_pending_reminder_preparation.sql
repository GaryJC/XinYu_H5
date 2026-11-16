-- Preparation can recover after a crash; only sealed HTTP attempts become unknown.
alter table personal_pending_deliveries add column lease_id uuid, add column lease_until timestamptz;
create index personal_pending_recipient_queue on personal_pending_deliveries(recipient_id,id) where status='pending';
