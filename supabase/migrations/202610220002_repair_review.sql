alter table dispatch_tasks drop constraint dispatch_tasks_stage_check;
alter table dispatch_tasks add constraint dispatch_tasks_stage_check
  check (stage in ('待派工','待接单','待开工','维修中','暂停','待检验','回审','维修完成'));
