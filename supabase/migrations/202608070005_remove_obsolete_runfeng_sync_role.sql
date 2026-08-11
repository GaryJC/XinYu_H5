do $$
begin
  if exists (select 1 from pg_roles where rolname = 'runfeng_sync') then
    execute format(
      'revoke all privileges on database %I from runfeng_sync',
      current_database()
    );
    revoke all privileges on schema public from runfeng_sync;
    revoke all privileges on table public.legacy_sync_outbox from runfeng_sync;
    revoke all privileges on function claim_legacy_sync_events(text, integer) from runfeng_sync;
    revoke all privileges on function acknowledge_legacy_sync_event(text, text, bigint, integer, text) from runfeng_sync;
    revoke all privileges on function fail_legacy_sync_event(text, text, text, integer) from runfeng_sync;
    revoke all privileges on function acknowledge_legacy_sync_events(text, jsonb) from runfeng_sync;
    revoke all privileges on function fail_legacy_sync_events(text, jsonb) from runfeng_sync;
    revoke all privileges on function retry_legacy_sync_event(text) from runfeng_sync;
    drop role runfeng_sync;
  end if;
end
$$;
