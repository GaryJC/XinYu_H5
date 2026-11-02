-- Preserve the vehicle identity and original recording time when a photo is reused.
alter table files add column nameplate_vehicle_vin text;
alter table files add column nameplate_vehicle_plate text;
alter table files add column nameplate_recorded_at timestamptz;
alter table files add column nameplate_source_file_id text;

update files f set
  nameplate_vehicle_vin=upper(regexp_replace(coalesce(w.vehicle_vin,''),'\s','','g')),
  nameplate_vehicle_plate=upper(regexp_replace(coalesce(w.vehicle_plate,''),'\s','','g')),
  nameplate_recorded_at=f.created_at
from work_orders w where w.id=f.order_id and f.kind='vehicle_nameplate_photo';

create index files_nameplate_vin_history on files(nameplate_vehicle_vin,nameplate_recorded_at desc)
  where kind='vehicle_nameplate_photo';
create index files_nameplate_plate_history on files(nameplate_vehicle_plate,nameplate_recorded_at desc)
  where kind='vehicle_nameplate_photo';
