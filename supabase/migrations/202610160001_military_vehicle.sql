alter table work_orders
  add column if not exists vehicle_is_military boolean not null default false;
