alter table users drop constraint users_role_check;
alter table users add constraint users_role_check check (role in ('advisor','technician','inspector','manager','warehouse','outsourcing','employee'));
alter table users drop constraint users_roles_valid;
alter table users add constraint users_roles_valid check (roles <@ array['manager','advisor','technician','inspector','warehouse','outsourcing','employee']::text[]);

alter table files drop constraint files_kind_check;
alter table files add constraint files_kind_check check (kind in ('vehicle_license','repair_order_photo','damage_photo','signature_image','other','repair_progress_photo','repair_parts_photo','repair_completed_photo','vehicle_nameplate_photo','trip_departure_photo','trip_return_photo','trip_signature'));

create table company_vehicles (
  id text primary key,
  shop_id text not null,
  plate text not null unique check (plate <> '' and plate = upper(regexp_replace(plate, '\s', '', 'g'))),
  brand text not null check (length(trim(brand)) > 0),
  model text not null check (length(trim(model)) > 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table vehicle_trip_requests (
  id text primary key,
  shop_id text not null,
  applicant_id text not null references users(id),
  applicant_name text not null,
  vehicle_id text not null references company_vehicles(id),
  vehicle_snapshot jsonb not null,
  reason text not null,
  note text not null default '',
  status text not null default '待审批' check (status in ('待审批','待出车','用车中','已还车','已驳回','已取消')),
  approved_by text references users(id),
  approved_name text,
  approved_at timestamptz,
  departure_at timestamptz,
  return_at timestamptz,
  rejection_reason text,
  created_at timestamptz not null default now(),
  check (approved_by is null or approved_by <> applicant_id)
);
create index vehicle_trip_shop_status on vehicle_trip_requests(shop_id,status,created_at desc);
create index vehicle_trip_applicant on vehicle_trip_requests(applicant_id,created_at desc);
create table vehicle_trip_attachments (
  file_id text primary key references files(id),
  trip_id text not null references vehicle_trip_requests(id),
  stage text not null check (stage in ('departure','return','signature')),
  uploaded_by text not null references users(id),
  confirmed boolean not null default false,
  created_at timestamptz not null default now()
);
create index vehicle_trip_attachment_trip on vehicle_trip_attachments(trip_id);
create table vehicle_trip_operations (
  actor_id text not null references users(id),
  request_id text not null,
  fingerprint text not null,
  trip_id text not null references vehicle_trip_requests(id),
  action text not null,
  actor_name text not null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key(actor_id,request_id)
);

insert into company_vehicles(id,shop_id,plate,brand,model) values
('cv_60778','shop-hq','鲁B60778','大众','捷达'),
('cv_dt7922','shop-hq','鲁BDT7922','众泰','云100s'),
('cv_ds3250','shop-hq','鲁BDS3250','众泰','云100s'),
('cv_dq2235','shop-hq','鲁BDQ2235','众泰','云100s'),
('cv_d56565','shop-hq','鲁BD56565','众泰','云100s'),
('cv_b62767','shop-hq','鲁BB62767','北汽','EV160'),
('cv_d09326','shop-hq','鲁BD09326','北汽','EX360'),
('cv_a86281','shop-hq','鲁BA86281','比亚迪','海鸥')
on conflict (plate) do nothing;
