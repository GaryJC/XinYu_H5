-- Inspector role eligibility no longer depends on repair participation.
-- Keep station inbox creation transactional and independent of DingTalk workers;
-- do not replay past jobs or change historical read state.
create or replace function capture_inspection_inbox() returns trigger language plpgsql as $$
begin
 insert into personal_inbox(event_key,recipient_id,shop_id,title,summary,plate,target_key,target_id)
 select 'dispatch:'||new.event_id::text||':待检验',u.id,w.shop_id,'待检验','请查看待检验维修项目',w.vehicle_plate,'dispatchOrder',w.id
 from dispatch_tasks d join work_orders w on w.id=d.order_id join users u on u.shop_id=w.shop_id
 where d.order_id=new.order_id and u.active and u.inspector_role_member is distinct from false
 and (case when cardinality(u.roles)>0 then u.roles else array[u.role] end) @> array['inspector']
 and d.stage in ('维修中','回审','待检验','暂停') and w.status not in ('草稿','待客户签字')
 and coalesce(d.data->>'executionMode','internal')<>'outsourced' and coalesce(d.data->>'needsReview','false')<>'true'
 and exists(select 1 from jsonb_array_elements(coalesce(nullif(d.data->'items','null'::jsonb),'[]'::jsonb)) i where i->>'status'='待检验')
 and (d.inspector_id is null or d.inspector_id=u.id)

 on conflict(recipient_id,event_key) do nothing;
 return new;
end $$;
