do $$
declare
  existing_constraint record;
begin
  for existing_constraint in
    select constraint_definition.conname
    from pg_constraint constraint_definition
    where constraint_definition.conrelid = 'public.legacy_sync_outbox'::regclass
      and constraint_definition.contype = 'c'
      and pg_get_constraintdef(constraint_definition.oid) like '%legacy_dispatch_no%'
  loop
    execute format(
      'alter table public.legacy_sync_outbox drop constraint %I',
      existing_constraint.conname
    );
  end loop;
end
$$;

alter table public.legacy_sync_outbox
  add constraint legacy_sync_outbox_synced_result_check
  check (
    status <> 'synced'
    or (
      legacy_reid is not null
      and legacy_document_no is not null
      and legacy_dispatch_no ~ '^[ABFJ][0-9]+$'
    )
  );
