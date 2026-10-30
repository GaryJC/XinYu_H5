alter table procurement_tenders add column winner_ids uuid[] not null default '{}';
update procurement_tenders set winner_ids=array[winner_id] where winner_id is not null;
