alter table public.work_orders add column legacy_approved boolean not null default false;
comment on column public.work_orders.legacy_approved is 'Latest Runfeng approval flag read from qxwxb.shbz (1 means approved)';
