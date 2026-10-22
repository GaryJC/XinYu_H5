-- Supplemental signatures collect a missing image without reopening the repair workflow.
alter table signature_tokens add column purpose text not null default 'authorization'
  check (purpose in ('authorization','supplement'));
