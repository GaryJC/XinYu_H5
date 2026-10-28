create table procurement_photos (
 file_id text primary key references files(id) on delete cascade,
 shop_id text not null,
 uploaded_by text not null references users(id),
 created_at timestamptz not null default now()
);
create index procurement_photos_shop_idx on procurement_photos(shop_id);
alter table procurement_photos enable row level security;
