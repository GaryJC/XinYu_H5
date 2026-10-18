alter table work_orders
  add column if not exists customer_vehicle_updated_at timestamptz,
  add column if not exists customer_vehicle_updated_by text;

-- An update must refer to the original repair order, including during ACK.
alter table legacy_sync_outbox add constraint legacy_sync_updated_identity_check check (
  event_type <> 'updated' or (
    legacy_reid is not null and legacy_reid > 0
    and legacy_document_no is not null and legacy_document_no > 0
    and legacy_dispatch_no is not null and legacy_dispatch_no ~ '^[ABFJ][0-9]+$'
  )
);

create or replace function protect_legacy_update_identity()
returns trigger language plpgsql as $$
begin
  if old.event_type = 'updated' and (
    new.event_type is distinct from old.event_type
    or new.order_id is distinct from old.order_id
    or new.legacy_reid is distinct from old.legacy_reid
    or new.legacy_document_no is distinct from old.legacy_document_no
    or new.legacy_dispatch_no is distinct from old.legacy_dispatch_no
  ) then
    raise exception 'updated event must retain original Runfeng reid/dh/pgd';
  end if;
  return new;
end
$$;

create trigger trg_protect_legacy_update_identity
before update on legacy_sync_outbox for each row execute function protect_legacy_update_identity();
