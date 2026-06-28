alter table work_orders add column if not exists dispatch_no text not null default '';
alter table work_orders add column if not exists arrival_date text not null default '';
alter table work_orders add column if not exists shop_id text not null default 'shop-hq';
alter table work_orders add column if not exists shop_name text not null default '上海虹桥店';
alter table work_orders add column if not exists shop_address text not null default '上海市闵行区虹桥汽修服务中心';
alter table work_orders add column if not exists shop_phone text not null default '021-6000-8618';

alter table repair_items add column if not exists start_at text not null default '';
alter table repair_items add column if not exists finish_at text not null default '';
alter table repair_items add column if not exists inspector text not null default '待检验';
alter table repair_items add column if not exists status text not null default '待派工'
  check (status in ('待派工', '待领料', '待开工', '维修中', '待检验', '已完工'));

create table if not exists shop_profiles (
  id text primary key,
  name text not null,
  address text not null,
  phone text not null,
  created_at timestamptz not null default now()
);

create table if not exists ocr_records (
  id text primary key,
  order_id text references work_orders(id) on delete cascade,
  field text not null check (field in ('plate', 'vin', 'mileage')),
  source text not null,
  file_id text not null,
  status text not null check (status in ('识别中', '待确认', '已确认', '识别失败')),
  value text not null default '',
  confidence numeric(5, 4) not null default 0,
  error text,
  created_at timestamptz not null default now(),
  confirmed_at timestamptz
);

create table if not exists platform_sync_records (
  id text primary key,
  order_id text not null references work_orders(id) on delete cascade,
  platform_order_no text not null,
  status text not null check (status in ('未同步', '同步中', '已同步', '同步失败')),
  message text not null default '',
  synced_at timestamptz not null default now()
);

create table if not exists outbound_orders (
  id text primary key,
  order_id text not null references work_orders(id) on delete cascade,
  dispatch_no text not null,
  platform_order_no text not null,
  technician text not null,
  status text not null check (status in ('待领料', '已领料', '部分领料')),
  created_at timestamptz not null default now()
);

create table if not exists outbound_order_items (
  id text primary key,
  outbound_order_id text not null references outbound_orders(id) on delete cascade,
  repair_item_id bigint not null,
  name text not null,
  quantity numeric(12, 2) not null default 1,
  picked boolean not null default false
);

create table if not exists settlement_statements (
  id text primary key,
  order_id text not null references work_orders(id) on delete cascade,
  dispatch_no text not null,
  plate text not null,
  technician text not null,
  amount numeric(12, 2) not null default 0,
  source text not null check (source in ('维修业务平台', '手动录入')),
  match_status text not null check (match_status in ('待匹配', '已匹配', '异常')),
  synced_at timestamptz not null default now()
);

create index if not exists idx_work_orders_dispatch_no on work_orders(dispatch_no);
create index if not exists idx_ocr_records_order_id on ocr_records(order_id);
create index if not exists idx_platform_sync_order_id on platform_sync_records(order_id);
create index if not exists idx_outbound_orders_order_id on outbound_orders(order_id);
create index if not exists idx_settlement_order_id on settlement_statements(order_id);

insert into shop_profiles (id, name, address, phone)
values ('shop-hq', '上海虹桥店', '上海市闵行区虹桥汽修服务中心', '021-6000-8618')
on conflict (id) do update set
  name = excluded.name,
  address = excluded.address,
  phone = excluded.phone;

update work_orders
set
  dispatch_no = case when dispatch_no = '' then replace(id, 'WT-', 'PG-') else dispatch_no end,
  arrival_date = case when arrival_date = '' then to_char(created_at at time zone 'Asia/Shanghai', 'YYYY-MM-DD') else arrival_date end;
