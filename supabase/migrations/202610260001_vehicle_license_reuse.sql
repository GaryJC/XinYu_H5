alter table files add column if not exists license_selected_at timestamptz;
alter table files add column if not exists license_vehicle_vin text;
alter table files add column if not exists license_source_file_id text references files(id) on delete set null;
create index if not exists files_vehicle_license_history_idx on files (license_vehicle_vin, license_selected_at desc) where kind='vehicle_license';
