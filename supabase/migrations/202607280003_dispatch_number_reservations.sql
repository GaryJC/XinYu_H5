create table if not exists dispatch_number_reservations (
  dispatch_no text primary key,
  numeric_value bigint not null unique,
  reserved_by text not null default '',
  reserved_at timestamptz not null default now(),
  consumed_order_id text unique references work_orders(id) on delete set null,
  consumed_at timestamptz,
  check (dispatch_no ~ '^A[0-9]+$')
);

insert into dispatch_number_reservations (
  dispatch_no,
  numeric_value,
  reserved_by,
  reserved_at,
  consumed_order_id,
  consumed_at
)
select
  dispatch_no,
  substring(dispatch_no from 2)::bigint,
  'existing-work-order',
  created_at,
  id,
  created_at
from work_orders
where dispatch_no ~ '^A[0-9]+$'
on conflict (dispatch_no) do nothing;

create index if not exists idx_dispatch_number_reservations_available
  on dispatch_number_reservations(numeric_value desc)
  where consumed_order_id is null;
