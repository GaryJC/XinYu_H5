alter table public.work_orders
  add column if not exists vehicle_model_legacy_code text not null default '';

create index if not exists idx_work_orders_vehicle_model_legacy_code
  on public.work_orders(vehicle_model_legacy_code)
  where vehicle_model_legacy_code <> '';
