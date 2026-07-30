# Database Setup

This project uses a Node API in front of Postgres and a legacy SQL Server integration. The frontend should keep using `/api/*` and must not connect to either database directly.

## Local Supabase

Prerequisites:

- Supabase CLI is installed as a local dev dependency.
- Docker or a Docker-compatible runtime is available on the machine.
- On macOS, this workspace uses Homebrew `docker` + `colima` as the local Docker runtime.

Commands:

```bash
npm run db:start
npm run db:reset
npm run dev
```

The default local connection string is:

```bash
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres
```

Override `DATABASE_URL` when using Supabase Cloud or another hosted Postgres provider.

## Legacy SQL Server 2000

The legacy company database is kept separate from Postgres. Its connection is lazy, so the main API can still start when the optional integration is not configured.

Local-only settings belong in `.env.local`:

```text
SQLSERVER_HOST=reachable-host-or-forwarder
SQLSERVER_PORT=1433
SQLSERVER_DATABASE=kxqpjxc2
SQLSERVER_USER=work-order-application-user
SQLSERVER_PASSWORD=
SQLSERVER_ENCRYPT=false
SQLSERVER_TDS_VERSION=7_1
```

Run the connection and table inventory check with:

```bash
npm run sqlserver:check
```

SQL Server 2000 requires TDS 7.1 and the current instance does not support encrypted connections. Keep port 1433 private, use a least-privilege account instead of `sa`, and grant only the reads and `dbo.qxwxb` writes required by the application. Keep all legacy SQL inside dedicated repositories. Catalog queries must use SQL Server 2000 objects such as `dbo.sysobjects`; newer views such as `sys.tables` are unavailable.

Vehicle recognition still reads the vehicle master from `dbo.qxclxxb` (`ch` = plate,
`sbdm` = VIN/chassis number, `cx` = model). H5 work-order creation and updates do not
write SQL Server. They commit the PostgreSQL business data and a versioned
`legacy_sync_outbox` event in one transaction. The Runfeng integration polls those
events, writes its own SQL Server, then acknowledges the event with `reid`, `dh`, and
`pgd`. See [legacy-sync-polling.md](./legacy-sync-polling.md).

## Database responsibilities

Postgres is the system of record for the complete H5 workflow. It stores the work order and dispatch number, SQL Server record link, arrival date, vehicle/customer snapshot, repair-item assignments and status, signature records, OCR records, outbound-order data, settlement data, audit history, and authenticated file metadata.

SQL Server remains a read-only vehicle source for H5 and a downstream interoperability
store populated by the Runfeng poller. PostgreSQL is authoritative for new H5 orders.

Image bytes are intentionally kept outside Postgres:

- local development writes them under `server/data/uploads`;
- production uses OSS when `OSS_BUCKET` is configured;
- Postgres stores the durable file record (`kind`, provider, bucket, object key, MIME type, size, uploader, and work-order relation).

Customer signature rows directly reference their `signature_image` file record through `signatures.file_id`. This keeps the relational workflow complete without putting large binary objects into transactional tables.

## Schema

The initial migration creates users, work orders, repair items, signature tokens, signatures, and audit logs. Core query fields are regular columns; inspection details remain `jsonb` so the work-order form can evolve without immediate table churn.

## Notes

`supabase/config.toml` disables analytics for local development. With Colima, the Supabase analytics/vector container can fail while mounting the Docker socket; analytics is not needed for this app's local Postgres workflow.
