create table dispatch_scheduler_notifications (
  event_id bigint primary key references dispatch_events(id),
  order_id text not null references dispatch_tasks(order_id) on delete cascade,
  kind text not null,
  payload jsonb not null,
  status text not null default 'pending' check(status in ('pending','ready','failed')),
  error text not null default '',
  attempts integer not null default 0,
  next_attempt_at timestamptz default now(),
  locked_until timestamptz,
  lease_id uuid,
  updated_at timestamptz not null default now()
);
alter table dispatch_scheduler_notifications enable row level security;
create index dispatch_scheduler_notifications_due on dispatch_scheduler_notifications(next_attempt_at) where status='pending';
-- System reminders must not impersonate a human operator.
alter table dispatch_events alter column actor_id drop not null;
create table dispatch_due_reminders (
  order_id text not null references dispatch_tasks(order_id) on delete cascade,
  recipient_id text not null references users(id),
  due_at timestamptz not null,
  lead_minutes integer not null check(lead_minutes in (2880,1440,60)),
  event_id bigint not null references dispatch_events(id),
  created_at timestamptz not null default now(),
  primary key(order_id,recipient_id,due_at,lead_minutes)
);
alter table dispatch_due_reminders enable row level security;
