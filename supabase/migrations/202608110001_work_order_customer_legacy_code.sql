alter table work_orders
  add column if not exists customer_legacy_code text not null default '';

create index if not exists idx_work_orders_customer_legacy_code
  on work_orders(customer_legacy_code)
  where customer_legacy_code <> '';
