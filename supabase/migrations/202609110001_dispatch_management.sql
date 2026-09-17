create table dispatch_tasks (
  order_id text primary key references work_orders(id) on delete cascade,
  shop_id text not null,
  technician_id text references users(id),
  inspector_id text references users(id),
  stage text not null check (stage in ('待派工','待接单','待开工','维修中','暂停','待检验','维修完成')),
  version integer not null default 0,
  data jsonb not null default '{}',
  updated_at timestamptz not null default now()
);
create index dispatch_tasks_shop_stage on dispatch_tasks(shop_id, stage);
create index dispatch_tasks_technician on dispatch_tasks(technician_id, stage);
create index dispatch_tasks_inspector on dispatch_tasks(inspector_id, stage);
create table dispatch_events (
  id bigint generated always as identity primary key,
  order_id text not null references dispatch_tasks(order_id) on delete cascade,
  actor_id text not null references users(id),
  actor_name text not null,
  request_id text not null,
  request_body jsonb not null,
  action text not null,
  detail jsonb not null,
  at timestamptz not null default now(),
  unique(order_id, actor_id, request_id)
);
create table dispatch_notifications (
  id uuid primary key,
  order_id text not null references dispatch_tasks(order_id) on delete cascade,
  event_id bigint not null references dispatch_events(id),
  recipient_id text not null references users(id),
  kind text not null,
  payload jsonb not null,
  status text not null default 'pending' check(status in ('pending','accepted','sent','failed','unknown')),
  attempts integer not null default 0,
  polls integer not null default 0,
  task_id text,
  error text not null default '',
  retryable boolean not null default false,
  next_attempt_at timestamptz default now(),
  locked_until timestamptz,
  lease_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(event_id, recipient_id, kind)
);
create index dispatch_notifications_due on dispatch_notifications(next_attempt_at) where status in ('pending','accepted','unknown');
create index dispatch_notifications_order on dispatch_notifications(order_id, created_at);
alter table dispatch_tasks enable row level security;
alter table dispatch_events enable row level security;
alter table dispatch_notifications enable row level security;

-- Preserve ambiguous legacy assignments for explicit reconciliation; never fabricate dates.
insert into dispatch_tasks(order_id, shop_id, technician_id, stage, data)
select wo.id, wo.shop_id,
  case when count(u.id) = 1 then min(u.id) end,
  case when wo.status in ('待结算','完成') then '维修完成'
       when wo.status = '维修中' then '维修中' else '待派工' end,
  jsonb_build_object('technicianName', wo.technician, 'legacy', true, 'startHistoryUnknown', wo.status='维修中',
    'needsReview', wo.status = '维修中' or (wo.technician not in ('','待派工') and count(u.id) <> 1),
    'items', coalesce((select jsonb_agg(jsonb_build_object(
      'id',ri.client_item_id,'name',ri.name,'status',ri.status,
      'startAt',nullif(ri.start_at,''),'finishAt',nullif(ri.finish_at,''),
      'inspectorName',ri.inspector) order by ri.item_no)
      from repair_items ri where ri.order_id=wo.id), '[]'::jsonb))
from work_orders wo left join users u on u.shop_id=wo.shop_id and u.name=wo.technician and u.role='technician'
where wo.status not in ('草稿','待客户签字')
group by wo.id;
