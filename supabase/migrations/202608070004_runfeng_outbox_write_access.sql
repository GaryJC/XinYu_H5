do $$
begin
  if exists (select 1 from pg_roles where rolname = 'runfeng_sync') then
    grant usage on schema public to runfeng_sync;
    grant select, insert, update, delete
      on table public.legacy_sync_outbox
      to runfeng_sync;
  end if;
end
$$;
