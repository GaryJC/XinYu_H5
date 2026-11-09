# Architecture

## Runtime

```text
DingTalk H5 / browser
        |
        v
Nginx (HTTPS + static dist)
        |
        +---- /api/* ----> Node HTTP server
                              |
                              +---- RDS PostgreSQL
                              +---- Legacy SQL Server 2000 (read-only)
                              +---- Aliyun OCR
                              +---- Aliyun OSS
                              +---- DingTalk OpenAPI
```

## Frontend boundaries

```text
client/src/
├── app/                  # Application entry and top-level routing
├── features/
│   ├── signature/        # Public customer signature workflow
│   ├── vehicle-license-ocr/
│   ├── work-orders/      # API and work-order components
│   └── workbench/        # Page composition and controller
├── integrations/
│   └── dingtalk/         # DingTalk browser JSAPI
└── shared/
    ├── api/              # HTTP transport and auth token handling
    └── ui/               # Business-agnostic form controls
```

Dependency direction:

```text
app -> features -> shared
             \-> integrations
```

Shared modules must not import feature modules. Pages compose features; controller hooks coordinate API calls and state.

## Server boundaries

```text
server/
├── config/               # Environment parsing and validation
├── database/             # Pool and transaction lifecycle
├── domain/               # Pure work-order mapping and business helpers
├── http/                 # HTTP errors, JSON responses, static files
├── repositories/         # Focused database access
├── routes/               # API endpoint dispatch
├── auth.mjs              # DingTalk login and session tokens
├── db.mjs                # Work-order persistence and transactional operations
├── ocr.mjs               # Aliyun OCR integration
├── storage.mjs           # OSS/local file storage
└── server.mjs            # Process entry and graceful shutdown
```

## Environment

- `.env.local`: local development only.
- `.env.production`: ECS runtime only.
- `.env.example`: committed variable names and safe defaults only.
- `VITE_*` variables are embedded into the frontend during build.
- Database, DingTalk secret, OSS secret, OCR secret, and JWT secret must never enter the frontend bundle.

## Quality gate

```bash
npm run check
```

This runs server tests, TypeScript checking, and the production frontend build.

## Stability and bounded work (2026-11-09)

- `shared/repairProgress.mjs` owns personal rework classification across tabs, counts, sort order and cards. An outsourced completion is not proof of internal inspection; completed-project attribution requires inspection evidence.
- HTTP requests accept `signal` and `timeoutMs`. Default deadlines are 20 seconds for reads, 60 seconds for mutations and 120 seconds for photos/OCR/exports. Cancellation and deadlines have distinct `kind` values, without pretending to be a business HTTP rejection. Mutation controllers retain the original request ID and payload on uncertain outcomes; transport never replays a write.
- Dispatch controllers have list/detail modes. Detail dialogs disable list queries, statistics and load summaries. Paged lists merge overlapping refreshes, abort obsolete reads and retain loaded mobile pages when refreshing.
- Dispatch personnel load when a detail editor opens or on explicit refresh, not on list/focus/timer refresh. Summary queries depend on their date range, not unrelated task filters. Browser reads share only in-flight requests for the same user; server `readDispatchPeople` shares only in-flight reads for the same shop, including workload readers. Successes and failures are evicted immediately. Transactional submissions continue calling fresh `dispatchPeople`, never the read coordinator. Inspector/scheduler notifications retain their live role synchronization and read local personnel afterwards, avoiding unrelated technician verification.
- Notification roster discovery opts into `pendingDingTalkRead`: overlapping role-catalog, membership-page and profile reads share work only for the same transport, access token, endpoint and request body. There is no settled-result cache; login/profile reads and command membership checks remain fresh by default. Each caller still checks its own shop, active state and recipient roles. A due-reminder transaction reads each shop's fresh roster once for its bounded batch (up to 100 candidate orders); that roster is discarded on completion/rollback, and delivery revalidates each recipient and task.
- Employee-detail reads require an explicit successful response and a profile matching the requested DingTalk user ID. Malformed JSON, missing profiles and identity mismatches fail before normalization or personnel synchronization; shared waiters receive the same failure and a later read retries normally.
- Inspection notification jobs take an advisory task/event/lease snapshot before remote roster discovery, skipping that discovery for obsolete or claimed work. The parent task and job are still locked and rechecked before any queue mutation. If work becomes actionable between snapshot and lock, the worker releases the transaction, resolves the live roster, then locks and checks again; it never substitutes local personnel for a missing/failed live roster. The usual actionable path retains its SQL round-trip count, while the snapshot additionally reads latest-event and lease metadata using existing keys.
- Dispatch SQL narrows only safe common candidates (owner, execution mode and literal search). Domain permission checks, historical fallback, tab counts, warehouse expansion and sorting remain authoritative; pagination follows these operations. `counts=true` retains its existing meaning. No projection table or business-data backfill is introduced.
- `/api/work-orders?view=summary&page=…` returns `WorkOrderListItem` without hydrated audit/history/signature data or signing tokens. Default list and detail responses stay compatible. Editing and printing always fetch full details.
- Project rows use one batched UPSERT, preserving financial columns and existing deletion/round boundaries. Authentication joins the current user with the active session on each request; there is no permission cache.
- Shared recoverable lazy boundaries expose an explicit retry and do not reload the page. Parent-owned draft state remains mounted. Authenticated thumbnails load near the viewport; a preview group retains at most three decoded full-image sources, releases them on close and keeps data URLs for DingTalk native image actions.
- PostgreSQL connection acquisition defaults to 5 seconds. Interactive transactions use a 3-second lock wait and 15-second statement deadline. Repair writeback worker transactions explicitly opt out. Rollback failure never replaces the original error and destroys the unusable connection. No automatic transaction replay is performed.
- Request timing logs use templated paths, sample normal requests at 5%, and retain errors/slow requests. They exclude query strings, payloads and credentials. Queue age and pool occupancy are sampled every 60 seconds. Signals stop new worker leases before draining HTTP and jobs; application grace is 60 seconds and PM2 grace is 70 seconds.
- `npm run check` includes bundle budgets. `npm run check:release` requires an explicit local `RELEASE_TEST_ADMIN_URL`, discovers PostgreSQL suites and fails on missing configuration or skipped cases. It never sources production environment files. Real SQL Server writes and real notifications are not enabled by this runner.

Vehicle-trip image preprocessing was explicitly excluded from this work while another chat changes that workflow. OSS latency under locks and orphaned objects on upload failure remain separate follow-up items.

Local shutdown acceptance also runs `DEPLOYMENT_PM2_TEST=true node --test test/deploymentRelease.integration.test.mjs test/gracefulHttp.integration.test.mjs`. These tests use temporary PM2 state and loopback HTTP fixtures; they do not deploy the application. `server/http/drainServer.mjs` shares the production drain ordering with unit and real-HTTP tests. PostgreSQL release tests exercise actual connection-acquisition and statement deadlines, rather than checking configuration values alone.
