-- Corrections may queue behind the first created event before it has a Runfeng ID.
-- Previously-applied migrations remain unchanged.
alter table legacy_sync_outbox drop constraint legacy_sync_updated_identity_check;
alter table legacy_sync_outbox add constraint legacy_sync_updated_identity_check check (
  event_type <> 'updated' or (
    legacy_reid is not null and legacy_reid > 0
    and legacy_document_no is not null and legacy_document_no > 0
    and legacy_dispatch_no is not null and legacy_dispatch_no ~ '^[ABFJ][0-9]+$'
  ) or (
    status = 'pending' and attempt_count = 0
    and legacy_reid is null and legacy_document_no is null and legacy_dispatch_no is null
  )
);

create or replace function protect_legacy_update_identity()
returns trigger language plpgsql set search_path = public as $$
declare
  first_claim boolean;
begin
  if old.event_type <> 'updated' then return new; end if;
  if new.event_type is distinct from old.event_type or new.order_id is distinct from old.order_id then
    raise exception 'updated event must retain original Runfeng reid/dh/pgd';
  end if;
  first_claim := old.status = 'pending' and old.attempt_count = 0 and old.locked_by is null
    and new.status = 'processing' and new.attempt_count = 1 and new.locked_by is not null;
  if first_claim then
    if not exists (select 1 from work_orders wo where wo.id = new.order_id
      and wo.legacy_reid = new.legacy_reid and wo.legacy_document_no = new.legacy_document_no
      and wo.dispatch_no = new.legacy_dispatch_no) then
      raise exception 'updated event must claim the original Runfeng reid/dh/pgd';
    end if;
    -- Initial dispatchNo was empty when this immutable correction snapshot queued.
    -- Complete only its association when the predecessor has committed and ACKed.
    new.payload := jsonb_set(new.payload, '{order,dispatchNo}', to_jsonb(new.legacy_dispatch_no));
  end if;
  if (new.legacy_reid is distinct from old.legacy_reid and not (first_claim and old.legacy_reid is null))
    or (new.legacy_document_no is distinct from old.legacy_document_no and not (first_claim and old.legacy_document_no is null))
    or (new.legacy_dispatch_no is distinct from old.legacy_dispatch_no and not (first_claim and old.legacy_dispatch_no is null)) then
    raise exception 'updated event must retain original Runfeng reid/dh/pgd';
  end if;
  return new;
end
$$;
