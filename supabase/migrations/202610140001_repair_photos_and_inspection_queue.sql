alter table files drop constraint files_kind_check;
alter table files add constraint files_kind_check check (kind in ('vehicle_license','repair_order_photo','damage_photo','signature_image','other','repair_progress_photo'));
alter table files add column upload_request_id text;
create unique index files_repair_upload_request on files(order_id,uploaded_by,upload_request_id) where upload_request_id is not null;
create table dispatch_inspection_notifications (
  event_id bigint primary key references dispatch_events(id),
  order_id text not null references dispatch_tasks(order_id) on delete cascade,
  status text not null default 'pending' check(status in ('pending','ready','failed','obsolete')),
  error text not null default '',
  attempts integer not null default 0,
  next_attempt_at timestamptz default now(),
  locked_until timestamptz,
  lease_id uuid,
  updated_at timestamptz not null default now()
);
alter table dispatch_inspection_notifications enable row level security;
create index dispatch_inspection_notifications_due on dispatch_inspection_notifications(next_attempt_at) where status='pending';
