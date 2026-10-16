-- Immutable completed rounds, plus the current round updated under the parent order lock.
create table dispatch_repair_rounds (
  order_id text not null references work_orders(id) on delete cascade,
  round_no integer not null check(round_no>=0),
  snapshot jsonb not null check(jsonb_typeof(snapshot)='object'),
  opened_by text references users(id),
  opened_name text not null default '',
  reason text not null default '',
  opened_at timestamptz,
  completed_at timestamptz,
  closed boolean not null default false,
  primary key(order_id,round_no)
);
alter table dispatch_repair_rounds enable row level security;
alter table files add column repair_round integer not null default 0 check(repair_round>=0);
create index files_repair_round_idx on files(order_id,repair_round) where kind='repair_progress_photo';
alter table dispatch_due_reminders add column repair_round integer not null default 0 check(repair_round>=0);
alter table dispatch_due_reminders drop constraint dispatch_due_reminders_pkey;
alter table dispatch_due_reminders add primary key(order_id,recipient_id,due_at,lead_minutes,repair_round);
