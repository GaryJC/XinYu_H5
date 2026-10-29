-- Durable event fanout is committed with the trip operation, independently of DingTalk availability.
create table vehicle_trip_notification_jobs (
  id text primary key,
  trip_id text not null references vehicle_trip_requests(id),
  actor_id text not null,
  request_id text not null,
  action text not null check (action in ('create','approve','reject','cancel','depart','return')),
  payload jsonb not null,
  status text not null default 'pending' check (status in ('pending','queued','obsolete','failed')),
  attempts integer not null default 0,
  error text not null default '',
  next_attempt_at timestamptz default now(),
  locked_until timestamptz,
  lease_id text,
  created_at timestamptz not null default now(),
  unique(actor_id,request_id),
  foreign key(actor_id,request_id) references vehicle_trip_operations(actor_id,request_id)
);
create index vehicle_trip_jobs_due on vehicle_trip_notification_jobs(next_attempt_at) where status='pending';
create table vehicle_trip_notifications (
  id text primary key,
  job_id text not null references vehicle_trip_notification_jobs(id),
  recipient_id text not null references users(id),
  status text not null default 'pending' check (status in ('pending','accepted','sent','unknown','failed')),
  attempts integer not null default 0,
  polls integer not null default 0,
  task_id text,
  error text not null default '',
  retryable boolean not null default false,
  next_attempt_at timestamptz default now(),
  locked_until timestamptz,
  lease_id text,
  created_at timestamptz not null default now(),
  unique(job_id,recipient_id)
);
create index vehicle_trip_notifications_due on vehicle_trip_notifications(next_attempt_at) where status in ('pending','accepted','unknown');
