-- Normalize the compatibility label in unacknowledged event snapshots only.
-- Do not change real signature records, ACKed history, claim locks or retries.
do $$
declare
  event public.legacy_sync_outbox%rowtype;
  signatures_json jsonb;
  contact_label text;
begin
  for event in
    select * from public.legacy_sync_outbox
    where status in ('pending', 'processing', 'failed')
    order by event_id for update
  loop
    contact_label := coalesce(nullif(regexp_replace(
      coalesce(event.payload #>> '{order,customer,contact}', ''),
      '^\s+|\s+$', '', 'g'), ''), '联系人');
    signatures_json := case when jsonb_typeof(event.payload #> '{order,signatures}') = 'object'
      then event.payload #> '{order,signatures}' else '{}'::jsonb end
      || jsonb_build_object('customer', contact_label);
    if event.payload #> '{order,signatures}' is distinct from signatures_json then
      insert into public.audit_logs(order_id, actor, action)
      values(event.order_id, '系统迁移：202610260004',
        '润丰同步签名文字改为联系人；不变更真实签名。修改前事件快照：' || to_jsonb(event)::text);
      update public.legacy_sync_outbox
      set payload = jsonb_set(payload, '{order,signatures}', signatures_json)
      where event_id = event.event_id;
    end if;
  end loop;
end
$$;
