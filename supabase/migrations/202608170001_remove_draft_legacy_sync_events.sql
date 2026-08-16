-- Drafts are editable local records and must not be exposed to the Runfeng poller.
-- Only remove events that have not been successfully consumed. A processing event
-- may already be held by a consumer, and a synced event is historical truth.
delete from legacy_sync_outbox as sync_event
using work_orders as work_order
where sync_event.order_id = work_order.id
  and work_order.status = '草稿'
  and sync_event.status in ('pending', 'failed');

update work_orders as work_order
set
  legacy_sync_status = 'not_applicable',
  legacy_sync_error = null
where work_order.status = '草稿'
  and not exists (
    select 1
    from legacy_sync_outbox as sync_event
    where sync_event.order_id = work_order.id
      and sync_event.status in ('processing', 'synced')
  );
