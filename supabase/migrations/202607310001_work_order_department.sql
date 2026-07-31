alter table work_orders
  add column if not exists department_code text not null default '',
  add column if not exists department_name text not null default '';

create index if not exists idx_work_orders_department_code
  on work_orders(department_code);
