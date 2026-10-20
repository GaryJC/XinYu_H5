create table repair_writebacks (
 id bigint generated always as identity primary key,
 event_id bigint not null unique references dispatch_events(id) on delete cascade,
 order_id text not null references work_orders(id) on delete cascade,
 snapshot jsonb not null,
 status text not null default 'pending' check(status in ('pending','synced','failed','manual')),
 attempts integer not null default 0,
 error text not null default '',
 next_attempt_at timestamptz not null default now(),
 created_at timestamptz not null default now(),
 synced_at timestamptz
);
create index repair_writebacks_pending on repair_writebacks(next_attempt_at,id) where status='pending';
