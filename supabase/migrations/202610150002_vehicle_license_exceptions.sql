create table vehicle_license_exceptions (
  id uuid primary key,
  order_id text not null references work_orders(id) on delete cascade,
  request_id text not null,
  vehicle_plate text not null,
  vehicle_vin text not null,
  reason text not null check(length(btrim(reason)) between 1 and 1000),
  reported_by text not null references users(id),
  reported_name text not null,
  reported_at timestamptz not null default now(),
  payload jsonb not null,
  status text not null default 'pending' check(status in ('pending','queued','failed')),
  error text not null default '',
  attempts integer not null default 0,
  next_attempt_at timestamptz default now(),
  locked_until timestamptz,
  lease_id uuid,
  unique(order_id,request_id)
);
create index vehicle_license_exceptions_order on vehicle_license_exceptions(order_id,reported_at desc);
create table vehicle_license_exception_notifications (
  id uuid primary key,
  exception_id uuid not null references vehicle_license_exceptions(id) on delete cascade,
  recipient_id text not null references users(id),
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
  unique(exception_id,recipient_id)
);
alter table vehicle_license_exceptions enable row level security;
alter table vehicle_license_exception_notifications enable row level security;
