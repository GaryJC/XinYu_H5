-- Keep legacy single-employee selections readable while storing equal collaborators
-- and execution details for signature-time activation.
alter table work_order_dispatch_plans alter column technician_id drop not null;
alter table work_order_dispatch_plans add column execution_data jsonb not null default '{}'::jsonb;
alter table work_order_dispatch_plans add constraint dispatch_plan_execution_object check (jsonb_typeof(execution_data) = 'object');
create index dispatch_tasks_technician_ids_idx on dispatch_tasks using gin ((data->'technicianIds'));
