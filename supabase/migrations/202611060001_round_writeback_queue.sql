-- Older workers claim exactly 'pending'. Keep round jobs isolated even if an
-- older retry API or deployment writes that status after rollback.
alter table repair_writebacks drop constraint repair_writebacks_status_check;
alter table repair_writebacks add constraint repair_writebacks_status_check
 check(status in ('pending','round_pending','synced','failed','manual'));
create function has_outsourced_repair(target_order text) returns boolean
 language sql stable as $$
 select exists(select 1 from dispatch_repair_rounds where order_id=target_order and snapshot->>'executionMode'='outsourced')
     or exists(select 1 from dispatch_tasks where order_id=target_order and data->>'executionMode'='outsourced')
     or exists(select 1 from dispatch_events where order_id=target_order and action='complete-outsourced')
$$;
create function protect_round_writeback_queue() returns trigger language plpgsql as $$
begin
 if new.status='pending' and (new.snapshot->>'operation'='write-round' or has_outsourced_repair(new.order_id)) then
  new.status:='round_pending';
 end if;
 return new;
end
$$;
create trigger protect_round_writeback_queue before insert or update on repair_writebacks
 for each row execute function protect_round_writeback_queue();
-- The original internal job can predate the first outsourced round. Move it
-- out of legacy workers' reach in the same transaction that changes the mode.
create function isolate_pending_on_outsourcing() returns trigger language plpgsql as $$
begin
 if tg_op='UPDATE' and old.data->>'executionMode'='outsourced' then return new; end if;
 update repair_writebacks set status='round_pending' where order_id=new.order_id and status='pending';
 return new;
end
$$;
create trigger isolate_pending_on_outsourcing after insert or update of data on dispatch_tasks
 for each row when (new.data->>'executionMode'='outsourced') execute function isolate_pending_on_outsourcing();
update repair_writebacks set status='round_pending' where status='pending'
 and (snapshot->>'operation'='write-round' or has_outsourced_repair(order_id));
create index repair_round_writebacks_order_idx on repair_writebacks(order_id,id)
 where snapshot->>'operation'='write-round';
create index repair_round_writebacks_due_idx on repair_writebacks(next_attempt_at,id) where status='round_pending';
