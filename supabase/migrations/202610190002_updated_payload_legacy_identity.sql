-- Runfeng consumers also read the association directly from payload_json.
-- Derive these fields from the protected SQL columns on insert and every update,
-- including the first claim of a correction queued before its creation was ACKed.
create or replace function include_updated_payload_legacy_identity()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.event_type = 'updated' then
    new.payload := new.payload || jsonb_build_object(
      'legacy_reid', new.legacy_reid,
      'legacy_document_no', new.legacy_document_no,
      'legacy_dispatch_no', new.legacy_dispatch_no
    );
  end if;
  return new;
end
$$;

create trigger include_updated_payload_legacy_identity
before insert or update on legacy_sync_outbox
for each row execute function include_updated_payload_legacy_identity();

-- Preserve original snapshots before adding association metadata. Do not change
-- claim state, locks, attempts, revisions, or business fields of existing events.
do $$
declare
  event public.legacy_sync_outbox%rowtype;
begin
  for event in
    select * from public.legacy_sync_outbox
    where event_type = 'updated'
      and payload is distinct from payload || jsonb_build_object(
        'legacy_reid', legacy_reid,
        'legacy_document_no', legacy_document_no,
        'legacy_dispatch_no', legacy_dispatch_no
      )
    order by event_id for update
  loop
    insert into public.audit_logs(order_id, actor, action)
    values(event.order_id, '系统迁移：202610190002',
      '补充 updated JSON 润丰关联编号；修改前事件快照：' || to_jsonb(event)::text);
    update public.legacy_sync_outbox set payload = payload || jsonb_build_object(
      'legacy_reid', event.legacy_reid,
      'legacy_document_no', event.legacy_document_no,
      'legacy_dispatch_no', event.legacy_dispatch_no
    ) where event_id = event.event_id;
  end loop;
end
$$;
