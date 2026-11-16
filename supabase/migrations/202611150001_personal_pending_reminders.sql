-- Persist committed source changes. Baselines are explicitly ineligible for reminders.
create table personal_pending_events (
 id bigint generated always as identity primary key, source_key text not null, target_id text not null,
 transaction_id bigint not null default txid_current(), snapshot jsonb not null, baseline boolean not null default false,
 created_at timestamptz not null default now(), unique(source_key,target_id,transaction_id)
);
create table personal_pending_subjects (
 id bigint generated always as identity primary key, source_key text not null,target_id text not null,shop_id text not null,
 slot_key text not null,kind text not null,slot jsonb not null,snapshot jsonb not null,
 entered_at timestamptz not null, eligible boolean not null, closed_at timestamptz,
 next_reminder_at timestamptz, level integer not null default 0
);
create unique index personal_pending_open on personal_pending_subjects(source_key,target_id,slot_key) where closed_at is null;
create index personal_pending_due on personal_pending_subjects(next_reminder_at,id) where closed_at is null and eligible;
create index personal_pending_target on personal_pending_subjects(target_id,kind) where closed_at is null;
create table personal_pending_deliveries (
 id bigint generated always as identity primary key, subject_id bigint not null references personal_pending_subjects(id),
 recipient_id text not null references users(id), stage text not null, level integer not null,
 status text not null default 'pending',created_at timestamptz not null default now(),
 submitted_at timestamptz,finished_at timestamptz,error text not null default '',task_id text,
 unique(subject_id,recipient_id,stage)
);
create index personal_pending_delivery_queue on personal_pending_deliveries(id) where status='pending';
alter table personal_pending_events enable row level security;
alter table personal_pending_subjects enable row level security;
alter table personal_pending_deliveries enable row level security;

create function pending_order_snapshot(target text) returns jsonb language sql stable as $$
 select jsonb_build_object('order',jsonb_build_object('id',w.id,'shop_id',w.shop_id,'status',w.status,'advisor',w.advisor,
 'vehicle_plate',w.vehicle_plate,'dispatch_no',w.dispatch_no,'customer_signature_review',w.customer_signature_review,
 'paper_order',w.paper_order,'legacy_sync_status',w.legacy_sync_status,'legacy_sync_error',w.legacy_sync_error),
 'dispatch',jsonb_build_object('stage',d.stage,'technician_id',d.technician_id,'inspector_id',d.inspector_id,'data',coalesce((select jsonb_object_agg(key,value) from jsonb_each(d.data) where key=any(array['items','technicianIds','participantIds','repairRound','assignedAt','executionMode','assignedBy','needsReview','workerSubmissions','repairPhotoWaivers'])), '{}'::jsonb)))
 from work_orders w left join dispatch_tasks d on d.order_id=w.id where w.id=target
$$;
create function capture_pending_source() returns trigger language plpgsql as $$
declare src text; target text; value jsonb;
begin
 if tg_table_name='vehicle_trip_requests' then
  src:='trip';target:=new.id;select jsonb_build_object('trip',jsonb_build_object('id',id,'shop_id',shop_id,'status',status,'applicant_id',applicant_id,'vehicle_snapshot',vehicle_snapshot)) into value from vehicle_trip_requests where id=target;
 else
  src:='order';if tg_table_name='dispatch_tasks' then target:=new.order_id;else target:=new.id;end if;
  value:=pending_order_snapshot(target);
 end if;
 if value is not null then
 insert into personal_pending_events(source_key,target_id,snapshot) values(src,target,value)
 on conflict(source_key,target_id,transaction_id) do update set snapshot=excluded.snapshot;
 end if;
 return new;
end $$;
-- Deferred snapshots see the final state of all writes in the transaction.
create constraint trigger pending_work_order after insert or update on work_orders deferrable initially deferred for each row execute function capture_pending_source();
create constraint trigger pending_dispatch after insert or update on dispatch_tasks deferrable initially deferred for each row execute function capture_pending_source();
create constraint trigger pending_trip after insert or update on vehicle_trip_requests deferrable initially deferred for each row execute function capture_pending_source();
insert into personal_pending_events(source_key,target_id,snapshot,baseline)
 select 'order',id,pending_order_snapshot(id),true from work_orders;
insert into personal_pending_events(source_key,target_id,snapshot,baseline)
 select 'trip',id,jsonb_build_object('trip',jsonb_build_object('id',id,'shop_id',shop_id,'status',status,'applicant_id',applicant_id,'vehicle_snapshot',vehicle_snapshot)),true from vehicle_trip_requests where status='待审批';

alter table personal_inbox add column notice_kind text not null default 'result' check(notice_kind in ('action','result'));
create function personal_notice_kind(title text) returns text language sql immutable as $$
 select case when title in ('待检验','维修已提检','回审已提交','需确认用户签字','出车申请待审批','新派工','派工通知','配件已备齐','配件备齐','待接单','无法接单','无照片待审批','采购待审批','采购申请待审批','配件可领取','人工催办','维修单回审','退回返工','追加维修派工','新增维修项目') or title like '采购提报审批：%' then 'action' else 'result' end
$$;
update personal_inbox set notice_kind=personal_notice_kind(title);
create function classify_personal_notice() returns trigger language plpgsql as $$begin new.notice_kind:=personal_notice_kind(new.title);return new;end $$;
create trigger classify_personal_notice before insert on personal_inbox for each row execute function classify_personal_notice();
create index personal_inbox_result_unread on personal_inbox(recipient_id,shop_id,id desc) where read_at is null and notice_kind='result';
