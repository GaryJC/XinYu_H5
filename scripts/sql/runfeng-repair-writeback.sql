-- Run once on the target SQL Server 2000 database after client acceptance.
-- No application startup DDL; grant the H5 account SELECT/INSERT on this table.
if object_id('dbo.h5_repair_writeback_receipts','U') is null
begin
 create table dbo.h5_repair_writeback_receipts (
  event_key varchar(150) not null primary key,
  payload_hash char(64) not null,
  dispatch_no varchar(20) not null,
  applied_at datetime not null default getdate()
 )
end
