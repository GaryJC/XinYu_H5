alter table procurement_links add column shared_token text;
alter table procurement_links add constraint procurement_shared_token_target check (shared_token is null or tender_id is not null);
