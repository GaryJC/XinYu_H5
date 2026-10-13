-- Merge the former scheduling role without changing employee identities or event history.
update users set role = 'advisor' where role = 'dispatcher';
update users set name = '服务顾问（原派单测试）' where id = 'u_dev_dispatcher' and name = '派单员（测试）';
update dingtalk_role_mappings set app_role = 'advisor', home_route = 'order-create' where app_role = 'dispatcher';
alter table users drop constraint users_role_check;
alter table users add constraint users_role_check check (role in ('advisor','technician','inspector','manager'));
alter table dingtalk_role_mappings drop constraint dingtalk_role_mappings_app_role_check;
alter table dingtalk_role_mappings add constraint dingtalk_role_mappings_app_role_check check (app_role in ('advisor','technician','inspector','manager'));

-- Draft selections are not executable repair tasks until customer signature commits.
create table work_order_dispatch_plans (
  order_id text primary key references work_orders(id) on delete cascade,
  technician_id text not null references users(id),
  assigned_by text not null references users(id),
  due_at timestamptz not null,
  urgent boolean not null default false,
  note text not null default '',
  activation_error text not null default '',
  activated_at timestamptz
);
alter table work_order_dispatch_plans enable row level security;
