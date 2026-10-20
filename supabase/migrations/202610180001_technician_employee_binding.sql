alter table users
  add column legacy_employee_code varchar(5),
  add column legacy_employee_name text,
  add column legacy_employee_department text,
  add column legacy_employee_bound_at timestamptz;

alter table users add constraint users_legacy_employee_binding_complete check (
  (legacy_employee_code is null and legacy_employee_name is null and legacy_employee_department is null and legacy_employee_bound_at is null)
  or (legacy_employee_code is not null and nullif(trim(legacy_employee_code), '') is not null and legacy_employee_name is not null and legacy_employee_department is not null and legacy_employee_bound_at is not null)
);
