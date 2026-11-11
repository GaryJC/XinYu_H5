-- Inbox is committed with business events, independently of delivery workers.
-- Existing delivery history is deliberately not replayed as new unread mail.
create table personal_inbox (
 id bigint generated always as identity primary key,
 event_key text not null,
 recipient_id text not null references users(id),
 shop_id text not null,
 title text not null,
 summary text not null default '',
 plate text not null default '',
 target_key text not null check(target_key in ('dispatchOrder','workOrder','vehicleTrip','procurementTender','procurementReport')),
 target_id text not null,
 created_at timestamptz not null default now(),
 read_at timestamptz,
 unique(recipient_id,event_key)
);
create index personal_inbox_page on personal_inbox(recipient_id,shop_id,id desc);
create index personal_inbox_unread on personal_inbox(recipient_id,shop_id,id desc) where read_at is null;
alter table personal_inbox enable row level security;

create function capture_personal_inbox() returns trigger language plpgsql as $$
declare k text; title_text text; shop text; target text; target_id_text text; p jsonb; audience text[];
begin
 p := new.payload;
 if tg_table_name='dispatch_notifications' or tg_table_name='dispatch_scheduler_notifications' then
  if new.kind in ('纸质委托书已创建','维修暂停','即将到期','检验项目待定','维修已提检','回审已提交') then return new; end if;
  select shop_id into shop from work_orders where id=new.order_id;
  title_text:=new.kind; target:=case when new.kind='需确认用户签字' then 'workOrder' else 'dispatchOrder' end; target_id_text:=new.order_id;
  if tg_table_name='dispatch_notifications' then
   k:='dispatch:'||coalesce(new.event_id::text,new.id::text)||':'||new.kind;
   audience:=array[new.recipient_id];
  else
   k:='dispatch:'||new.event_id::text||':'||new.kind;
   select array_agg(u.id) into audience from users u join work_orders w on w.id=new.order_id
    where u.active and u.shop_id=w.shop_id and u.name=w.advisor and btrim(u.name)<>''
    and (u.role in ('advisor','manager') or u.roles && array['advisor','manager']::text[]);
  end if;
 elsif tg_table_name='procurement_notification_jobs' then
  shop:=new.shop_id; title_text:=p->>'title'; k:='procurement:'||new.id;
  target:=case when new.tender_id is not null then 'procurementTender' else 'procurementReport' end;
  target_id_text:=coalesce(new.tender_id::text,new.report_id::text);
  select array_agg(id) into audience from users where active and shop_id=shop
   and (role=coalesce(p->>'recipientRole','warehouse') or roles @> array[coalesce(p->>'recipientRole','warehouse')]);
 elsif tg_table_name='vehicle_trip_notification_jobs' then
  if new.action='return' then return new; end if;
  shop:=p->>'shopId'; k:='trip:'||new.id; target:='vehicleTrip'; target_id_text:=new.trip_id;
  title_text:=case new.action when 'create' then '出车申请待审批' when 'approve' then '出车申请已批准' when 'reject' then '出车申请已驳回' when 'cancel' then '出车申请已取消' when 'depart' then '车辆已出车' when 'approve-return' then '收车审核通过' when 'reject-return' then '收车审核退回' end;
  select array_agg(id) into audience from users where active and shop_id=shop and
   (case when new.action in ('create','cancel','depart') then id<>p->>'applicantId' and (role='manager' or roles @> array['manager']) else id=p->>'applicantId' end);
 end if;
 insert into personal_inbox(event_key,recipient_id,shop_id,title,summary,plate,target_key,target_id)
 select k,u.id,shop,title_text,coalesce(p->>'summary',p->>'reason',''),coalesce(p->>'plate',p->'vehicle'->>'plate',''),target,target_id_text
 from users u where u.id=any(audience) and u.active and u.shop_id=shop
 on conflict(recipient_id,event_key) do nothing;
 return new;
end $$;
create trigger inbox_dispatch after insert on dispatch_notifications for each row execute function capture_personal_inbox();
create trigger inbox_scheduler after insert on dispatch_scheduler_notifications for each row execute function capture_personal_inbox();
create trigger inbox_procurement after insert on procurement_notification_jobs for each row execute function capture_personal_inbox();
create trigger inbox_trip after insert on vehicle_trip_notification_jobs for each row execute function capture_personal_inbox();

-- Uses the same independence exclusions as canInspect, without remote roster calls.
create function capture_inspection_inbox() returns trigger language plpgsql as $$
begin
 insert into personal_inbox(event_key,recipient_id,shop_id,title,summary,plate,target_key,target_id)
 select 'dispatch:'||new.event_id::text||':待检验',u.id,w.shop_id,'待检验','请查看待检验维修项目',w.vehicle_plate,'dispatchOrder',w.id
 from dispatch_tasks d join work_orders w on w.id=d.order_id join users u on u.shop_id=w.shop_id
 where d.order_id=new.order_id and u.active and u.inspector_role_member is distinct from false
 and (u.role='inspector' or u.roles @> array['inspector'])
 and (d.inspector_id is null or d.inspector_id=u.id)
 and not coalesce(d.data->'technicianIds',jsonb_build_array(d.technician_id)) ? u.id
 and not coalesce(d.data->'participantIds','[]'::jsonb) ? u.id
 and not exists(select 1 from jsonb_array_elements(coalesce(d.data->'items','[]'::jsonb)) i
   where i->>'responsibleId'=u.id or i->>'startedBy'=u.id or i->>'finishedBy'=u.id)
 on conflict(recipient_id,event_key) do nothing;
 return new;
end $$;
create trigger inbox_inspection after insert on dispatch_inspection_notifications for each row execute function capture_inspection_inbox();
