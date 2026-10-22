-- Keep the existing primary role for landing pages and older clients.
alter table users add column roles text[] not null default '{}';
update users set roles = array[role];
alter table users add constraint users_roles_valid check (
  roles <@ array['manager','advisor','technician','inspector','warehouse','outsourcing']::text[]
);
