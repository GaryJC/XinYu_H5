alter table files drop constraint files_kind_check;
alter table files add constraint files_kind_check check (kind in ('vehicle_license','repair_order_photo','damage_photo','signature_image','other','repair_progress_photo','repair_parts_photo'));
create index files_parts_round_idx on files(order_id,repair_round) where kind='repair_parts_photo';
-- Parts requirements and dispatch sheet metadata are persisted with the task and audit event,
-- including subsequent repair-round snapshots. No inventory or settlement mutation is performed.
