# Database Setup

This project uses a Node API in front of Postgres and a read-only legacy SQL Server integration. The frontend should keep using `/api/*` and must not connect to either database directly.

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
SQLSERVER_USER=read-only-application-user
SQLSERVER_PASSWORD=
SQLSERVER_ENCRYPT=false
SQLSERVER_TDS_VERSION=7_1
```

Run the read-only connection and table inventory check with:

```bash
npm run sqlserver:check
```

SQL Server 2000 requires TDS 7.1 and the current instance does not support encrypted connections. Keep port 1433 private, use a least-privilege account instead of `sa`, and keep all legacy SQL inside dedicated repositories. Catalog queries must use SQL Server 2000 objects such as `dbo.sysobjects`; newer views such as `sys.tables` are unavailable.

Vehicle recognition reads the vehicle master from `dbo.qxclxxb` (`ch` = plate, `sbdm` = VIN/chassis number, `cx` = model). New dispatch numbers use the highest valid `A<number>` value in `dbo.qxwxb.pgd` as their baseline; Postgres only coordinates reservations so concurrent H5 users do not receive the same next number.

## Database responsibilities

Postgres is the system of record for the H5 workflow. It stores the work order and dispatch number, arrival date, vehicle/customer snapshot, repair-item assignments and status, signature records, OCR records, outbound-order data, settlement data, audit history, and authenticated file metadata.

SQL Server remains the legacy read source for vehicle master data and the current maximum dispatch number. It does not store H5 uploads, signatures, or workflow state.

Image bytes are intentionally kept outside Postgres:

- local development writes them under `server/data/uploads`;
- production uses OSS when `OSS_BUCKET` is configured;
- Postgres stores the durable file record (`kind`, provider, bucket, object key, MIME type, size, uploader, and work-order relation).

Customer signature rows directly reference their `signature_image` file record through `signatures.file_id`. This keeps the relational workflow complete without putting large binary objects into transactional tables.

## Schema

The initial migration creates users, work orders, repair items, signature tokens, signatures, and audit logs. Core query fields are regular columns; inspection details remain `jsonb` so the work-order form can evolve without immediate table churn.

## Notes

`supabase/config.toml` disables analytics for local development. With Colima, the Supabase analytics/vector container can fail while mounting the Docker socket; analytics is not needed for this app's local Postgres workflow.
