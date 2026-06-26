create table if not exists users (
  id text primary key,
  name text not null,
  role text not null check (role in ('advisor', 'dispatcher', 'technician', 'inspector', 'manager')),
  dingtalk_user_id text unique,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists work_orders (
  id text primary key,
  status text not null check (status in ('草稿', '待客户签字', '已委托', '待派工', '维修中', '待结算', '完成')),
  advisor text not null,
  technician text not null,
  inspector text not null,
  vehicle_plate text not null default '',
  vehicle_vin text not null default '',
  vehicle_mileage text not null default '',
  vehicle_model text not null default '',
  vehicle_purchase_date text not null default '',
  customer_name text not null default '',
  customer_phone text not null default '',
  customer_contact text not null default '',
  customer_address text not null default '',
  inspection jsonb not null default '{"belongings": [], "fuelLevel": "1/2", "exteriorIssues": []}'::jsonb,
  fault_description text not null default '',
  estimated_fee numeric(12, 2) not null default 0,
  old_parts_handling text not null check (old_parts_handling in ('客户带走', '门店回收', '环保处理')),
  estimated_delivery_at text not null default '',
  settlement_amount numeric(12, 2) not null default 0,
  fee_note text not null default '',
  platform_order_no text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists repair_items (
  id bigint generated always as identity primary key,
  order_id text not null references work_orders(id) on delete cascade,
  client_item_id bigint not null,
  item_no integer not null,
  name text not null default '',
  labor_fee numeric(12, 2) not null default 0,
  owner text not null default '待派工',
  unique (order_id, client_item_id)
);

create table if not exists signature_tokens (
  token text primary key,
  order_id text not null references work_orders(id) on delete cascade,
  used boolean not null default false,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  used_at timestamptz
);

create table if not exists signatures (
  id bigint generated always as identity primary key,
  order_id text not null references work_orders(id) on delete cascade,
  signer_type text not null check (signer_type in ('customer', 'advisor', 'inspector', 'reception')),
  signer_name text not null,
  signed_at timestamptz not null default now(),
  unique (order_id, signer_type)
);

create table if not exists audit_logs (
  id bigint generated always as identity primary key,
  order_id text not null references work_orders(id) on delete cascade,
  at timestamptz not null default now(),
  actor text not null,
  action text not null
);

create index if not exists idx_work_orders_status on work_orders(status);
create index if not exists idx_work_orders_advisor on work_orders(advisor);
create index if not exists idx_work_orders_technician on work_orders(technician);
create index if not exists idx_work_orders_updated_at on work_orders(updated_at desc);
create index if not exists idx_repair_items_order_id on repair_items(order_id);
create index if not exists idx_signature_tokens_order_id on signature_tokens(order_id);
create index if not exists idx_signature_tokens_unused on signature_tokens(order_id, created_at desc) where used = false;
create index if not exists idx_audit_logs_order_id_at on audit_logs(order_id, at desc);
