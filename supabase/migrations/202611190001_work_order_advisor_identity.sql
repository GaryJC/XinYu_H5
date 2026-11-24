-- A historical name alone cannot reliably identify an employee. Capture IDs on new orders and explicit transfers.
alter table work_orders add column advisor_user_id text references users(id);
