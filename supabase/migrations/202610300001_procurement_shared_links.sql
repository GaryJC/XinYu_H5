alter table procurement_links add column tender_id uuid references procurement_tenders(id);
alter table procurement_links drop constraint procurement_links_check;
alter table procurement_links add constraint procurement_links_target_check check (num_nonnulls(invitation_id,report_id,tender_id)=1);
alter table procurement_sessions add column invitation_id uuid references procurement_invitations(id);
