-- Separate receipts: simulation must never acknowledge or consume a real job.
create table if not exists repair_writeback_simulations (
 job_id bigint primary key references repair_writebacks(id) on delete cascade,
 status text not null check(status in ('pending','synced','failed')),
 attempts integer not null default 0,
 error text not null default '',
 snapshot jsonb,
 synced_at timestamptz,
 updated_at timestamptz not null default now()
);
alter table repair_writeback_simulations enable row level security;
