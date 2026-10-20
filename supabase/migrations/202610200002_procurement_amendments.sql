-- Preserve prior quotes when published requirements change; require a quote against current terms.
alter table procurement_tenders add column version integer not null default 0 check(version>=0);
alter table procurement_tenders add column terms_version integer not null default 1 check(terms_version>0);
alter table procurement_quotes add column terms_version integer not null default 1 check(terms_version>0);
