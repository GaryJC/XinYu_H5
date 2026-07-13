create table if not exists dingtalk_department_mappings (
  dingtalk_department_id text primary key,
  dingtalk_department_name text not null,
  shop_id text not null references shop_profiles(id),
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists dingtalk_role_mappings (
  dingtalk_role_id text primary key,
  dingtalk_role_name text not null,
  app_role text not null check (app_role in ('advisor', 'dispatcher', 'technician', 'inspector', 'manager')),
  shop_id text references shop_profiles(id),
  home_route text not null check (home_route in ('workbench', 'order-create')),
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists dingtalk_user_snapshots (
  dingtalk_user_id text primary key,
  name text not null default '',
  phone text,
  department_ids jsonb not null default '[]'::jsonb,
  role_list jsonb not null default '[]'::jsonb,
  active boolean not null default true,
  synced_at timestamptz not null default now()
);

create index if not exists idx_dingtalk_role_mappings_enabled on dingtalk_role_mappings(enabled);
create index if not exists idx_dingtalk_department_mappings_enabled on dingtalk_department_mappings(enabled);

update shop_profiles
set name = '抚顺路店'
where id = 'shop-hq';

update work_orders
set shop_name = '抚顺路店'
where shop_id = 'shop-hq';
