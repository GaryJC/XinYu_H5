alter table company_vehicles
 add column insurance_start date,
 add column insurance_end date,
 add column insurance_details jsonb not null default '{}'::jsonb,
 add constraint company_vehicle_insurance_dates check ((insurance_start is null and insurance_end is null) or (insurance_start is not null and insurance_end is not null and insurance_end>=insurance_start));
create index company_vehicle_insurance_due on company_vehicles(insurance_end) where active;
create table vehicle_insurance_notifications (
 id text primary key, vehicle_id text not null references company_vehicles(id) on delete cascade,
 recipient_id text not null references users(id), insurance_end date not null, milestone integer not null,
 status text not null default 'pending', attempts integer not null default 0, polls integer not null default 0,
 task_id text, error text not null default '', retryable boolean not null default false,
 next_attempt_at timestamptz default now(), locked_until timestamptz, lease_id text,
 unique(vehicle_id,insurance_end,milestone,recipient_id)
);
create index vehicle_insurance_notifications_due on vehicle_insurance_notifications(next_attempt_at) where next_attempt_at is not null;
alter table vehicle_insurance_notifications enable row level security;
