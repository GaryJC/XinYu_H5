alter table work_orders add column pending_repairs jsonb not null default '[]'::jsonb;
alter table work_orders add column pending_repairs_version integer not null default 0;
create sequence pending_repair_item_ids start 1000000000;
create table pending_repair_requests (
 order_id text not null references work_orders(id) on delete cascade,
 request_id text not null,
 actor_id text not null references users(id),
 body jsonb not null,
 primary key(order_id, actor_id, request_id)
);
