-- Independent sealed supplier portal; internal managers and warehouse staff see live quotes.
create table procurement_suppliers (
 id uuid primary key, shop_id text not null, name text not null, contact_name text not null,
 phone text not null, categories text not null default '', note text not null default '', active boolean not null default true,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(shop_id,name)
);
create table procurement_tenders (
 id uuid primary key, shop_id text not null, created_by text not null references users(id),
 request_id uuid not null, request_body jsonb not null, data jsonb not null,
 status text not null default 'open' check(status in ('open','closed','awarded','failed','cancelled')),
 deadline timestamptz, closed_at timestamptz, settled_at timestamptz,
 winner_id uuid references procurement_suppliers(id), reason text not null default '',
 created_at timestamptz not null default now(), unique(created_by,request_id)
);
create index procurement_tenders_shop on procurement_tenders(shop_id,created_at desc);
create index procurement_tenders_deadline on procurement_tenders(deadline) where status='open';
create table procurement_invitations (
 id uuid primary key, tender_id uuid not null references procurement_tenders(id), supplier_id uuid not null references procurement_suppliers(id),
 supplier_snapshot jsonb not null, unique(tender_id,supplier_id)
);
create table procurement_quotes (
 id uuid primary key, invitation_id uuid not null references procurement_invitations(id), request_id uuid not null,
 data jsonb not null, submitted_at timestamptz not null default clock_timestamp(), unique(invitation_id,request_id)
);
create index procurement_quotes_latest on procurement_quotes(invitation_id,submitted_at desc,id desc);
create table procurement_invalidations (
 invitation_id uuid primary key references procurement_invitations(id), reason text not null,
 actor_id text not null references users(id), at timestamptz not null default now()
);
create table procurement_reports (
 id uuid primary key, shop_id text not null, supplier_id uuid not null references procurement_suppliers(id),
 snapshot jsonb not null, created_by text not null references users(id), created_at timestamptz not null default now(), published_at timestamptz
);
create table procurement_links (
 id uuid primary key, invitation_id uuid references procurement_invitations(id), report_id uuid references procurement_reports(id),
 token_hash text not null unique, expires_at timestamptz not null, revoked_at timestamptz,
 created_at timestamptz not null default now(), check((invitation_id is null) <> (report_id is null))
);
create table procurement_sessions (
 token_hash text primary key, link_id uuid not null references procurement_links(id), expires_at timestamptz not null,
 created_at timestamptz not null default now()
);
create table procurement_access_attempts (
 key text primary key, count integer not null default 1, expires_at timestamptz not null
);
create table procurement_audit (
 id bigint generated always as identity primary key, shop_id text not null,
 tender_id uuid references procurement_tenders(id), supplier_id uuid references procurement_suppliers(id),
 actor text not null, action text not null, detail jsonb not null default '{}', at timestamptz not null default now()
);
create table procurement_notifications (
 id uuid primary key, tender_id uuid references procurement_tenders(id), report_id uuid references procurement_reports(id),
 shop_id text not null, recipient_id text not null references users(id), payload jsonb not null,
 status text not null default 'pending' check(status in ('pending','accepted','sent','failed','unknown')),
 attempts integer not null default 0, polls integer not null default 0, task_id text,
 error text not null default '', retryable boolean not null default false, next_attempt_at timestamptz default now(),
 locked_until timestamptz, lease_id uuid, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index procurement_notifications_due on procurement_notifications(next_attempt_at) where status in ('pending','accepted','unknown');
alter table procurement_suppliers enable row level security;
alter table procurement_tenders enable row level security;
alter table procurement_invitations enable row level security;
alter table procurement_quotes enable row level security;
alter table procurement_invalidations enable row level security;
alter table procurement_reports enable row level security;
alter table procurement_links enable row level security;
alter table procurement_sessions enable row level security;
alter table procurement_access_attempts enable row level security;
alter table procurement_audit enable row level security;
alter table procurement_notifications enable row level security;
create table procurement_notification_jobs (
 id uuid primary key, shop_id text not null, tender_id uuid references procurement_tenders(id), report_id uuid references procurement_reports(id),
 payload jsonb not null, status text not null default 'pending' check(status in ('pending','ready','failed')),
 attempts integer not null default 0, error text not null default '', next_attempt_at timestamptz not null default now(),
 locked_until timestamptz, lease_id uuid, created_at timestamptz not null default now()
);
alter table procurement_notification_jobs enable row level security;
