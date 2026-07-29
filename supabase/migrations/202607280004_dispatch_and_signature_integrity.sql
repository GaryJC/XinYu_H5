create unique index if not exists idx_work_orders_dispatch_no_unique
  on work_orders(dispatch_no)
  where dispatch_no ~ '^A[0-9]+$';

alter table signatures
  add column if not exists file_id text references files(id) on delete set null;

create index if not exists idx_signatures_file_id
  on signatures(file_id);
