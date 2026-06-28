# Database Setup

This project uses a Node API in front of Postgres. The frontend should keep using `/api/*` and must not connect to Supabase tables directly.

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

## Schema

The initial migration creates users, work orders, repair items, signature tokens, signatures, and audit logs. Core query fields are regular columns; inspection details remain `jsonb` so the work-order form can evolve without immediate table churn.

## Notes

`supabase/config.toml` disables analytics for local development. With Colima, the Supabase analytics/vector container can fail while mounting the Docker socket; analytics is not needed for this app's local Postgres workflow.
