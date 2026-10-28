alter table files drop constraint if exists files_kind_check;
alter table files add constraint files_kind_check check (kind in ('vehicle_license','repair_order_photo','damage_photo','signature_image','other','repair_progress_photo','repair_parts_photo','repair_completed_photo','vehicle_nameplate_photo'));
create index files_vehicle_nameplate_idx on files(order_id) where kind='vehicle_nameplate_photo';
