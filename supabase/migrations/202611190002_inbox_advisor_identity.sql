-- Match the order owner used for scheduler delivery when capturing its inbox message.
create or replace function capture_personal_inbox() returns trigger language plpgsql as $$
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
    where u.active and u.shop_id=w.shop_id and (u.id=w.advisor_user_id or (w.advisor_user_id is null and u.name=w.advisor and btrim(u.name)<>''))
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
