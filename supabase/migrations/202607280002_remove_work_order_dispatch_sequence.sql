alter table work_orders
  alter column dispatch_no set default '';

drop index if exists idx_work_orders_generated_dispatch_no;
drop function if exists next_work_order_dispatch_no();
drop sequence if exists work_order_dispatch_no_seq;
