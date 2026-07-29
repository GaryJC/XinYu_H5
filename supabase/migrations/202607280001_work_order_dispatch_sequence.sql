create sequence if not exists work_order_dispatch_no_seq;

create or replace function next_work_order_dispatch_no()
returns text
language sql
volatile
as $$
  select
    'PG-' ||
    to_char(current_timestamp at time zone 'Asia/Shanghai', 'YYYYMMDD') ||
    '-' ||
    lpad(nextval('work_order_dispatch_no_seq')::text, 6, '0')
$$;

alter table work_orders
  alter column dispatch_no set default next_work_order_dispatch_no();

update work_orders
set dispatch_no = next_work_order_dispatch_no()
where dispatch_no = '';

create unique index if not exists idx_work_orders_generated_dispatch_no
  on work_orders(dispatch_no)
  where dispatch_no ~ '^PG-[0-9]{8}-[0-9]{6}$';
