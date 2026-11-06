-- SQL Server 2000. Apply before deploying mixed-round writeback.
-- The writer needs SELECT/INSERT here and UPDATE(hh,wxr) on qxwxmxb.
if object_id('dbo.h5_repair_round_items','U') is null
begin
 create table dbo.h5_repair_round_items (
  item_key char(64) not null primary key,
  detail_reid int not null unique
 )
end
