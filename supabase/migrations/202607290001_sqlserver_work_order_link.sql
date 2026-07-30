alter table work_orders
  add column if not exists legacy_reid bigint,
  add column if not exists legacy_document_no integer,
  add column if not exists legacy_sync_status text not null default 'not_applicable',
  add column if not exists legacy_synced_at timestamptz;

alter table work_orders
  drop constraint if exists work_orders_legacy_sync_status_check;

alter table work_orders
  add constraint work_orders_legacy_sync_status_check
  check (legacy_sync_status in ('not_applicable', 'synced'));

create unique index if not exists idx_work_orders_legacy_reid_unique
  on work_orders(legacy_reid)
  where legacy_reid is not null;
