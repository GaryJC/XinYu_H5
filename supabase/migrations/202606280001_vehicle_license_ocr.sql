alter table ocr_records drop constraint if exists ocr_records_field_check;

alter table ocr_records
  add constraint ocr_records_field_check
  check (field in ('vehicleLicense', 'plate', 'vin', 'mileage'));
