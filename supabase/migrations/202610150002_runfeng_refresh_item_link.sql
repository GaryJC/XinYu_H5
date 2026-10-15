-- Stable source identities let subsequent Runfeng edits preserve local repair progress.
alter table repair_items add column legacy_item_reid integer;
create unique index idx_repair_items_legacy_item on repair_items(order_id, legacy_item_reid)
  where legacy_item_reid is not null;
