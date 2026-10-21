alter table users drop constraint users_role_check;
alter table users add constraint users_role_check check (role in ('advisor','technician','inspector','manager','warehouse','outsourcing'));
alter table dingtalk_role_mappings drop constraint dingtalk_role_mappings_app_role_check;
alter table dingtalk_role_mappings add constraint dingtalk_role_mappings_app_role_check check (app_role in ('advisor','technician','inspector','manager','warehouse','outsourcing'));
