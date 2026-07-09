alter table users add column if not exists shop_id text not null default 'shop-hq';
alter table users add column if not exists phone text;
alter table users add column if not exists last_login_at timestamptz;

create table if not exists auth_sessions (
  id text primary key,
  user_id text not null references users(id) on delete cascade,
  token_hash text not null unique,
  user_agent text,
  ip_address text,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);

create table if not exists files (
  id text primary key,
  order_id text references work_orders(id) on delete cascade,
  kind text not null check (kind in ('vehicle_license', 'repair_order_photo', 'damage_photo', 'signature_image', 'other')),
  storage_provider text not null default 'oss' check (storage_provider in ('oss', 'local')),
  bucket text not null,
  object_key text not null,
  original_name text,
  mime_type text,
  size_bytes bigint,
  uploaded_by text references users(id),
  created_at timestamptz not null default now()
);

alter table ocr_records drop constraint if exists ocr_records_field_check;

alter table ocr_records
  add constraint ocr_records_field_check
  check (field in ('vehicleLicense', 'plate', 'vin', 'mileage'));

create index if not exists idx_users_dingtalk_user_id on users(dingtalk_user_id);
create index if not exists idx_auth_sessions_user_id on auth_sessions(user_id);
create index if not exists idx_auth_sessions_token_hash on auth_sessions(token_hash);
create index if not exists idx_files_order_id on files(order_id);
create index if not exists idx_files_uploaded_by on files(uploaded_by);
