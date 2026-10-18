alter table work_orders add column paper_order jsonb;
alter table work_orders add constraint work_orders_paper_order_check check (
  paper_order is null or (
    jsonb_typeof(paper_order) = 'object'
    and paper_order->>'mode' in ('pending','dingtalk','runfeng')
    and jsonb_typeof(paper_order->'photoIds') = 'array'
    and jsonb_array_length(paper_order->'photoIds') > 0
  ) is true
);
alter table work_orders drop constraint work_orders_status_check;
alter table work_orders add constraint work_orders_status_check check (
  status in ('草稿','待客户签字','待处理纸质委托书','已委托','待派工','维修中','待结算','完成')
);
-- Creation notifications exist before a dispatch task or dispatch event does.
alter table dispatch_notifications drop constraint dispatch_notifications_order_id_fkey;
alter table dispatch_notifications add constraint dispatch_notifications_order_id_fkey
  foreign key(order_id) references work_orders(id) on delete cascade;
alter table dispatch_notifications alter column event_id drop not null;
create unique index paper_order_creation_notification_once
  on dispatch_notifications(order_id,recipient_id,kind) where kind='纸质委托书已创建';
