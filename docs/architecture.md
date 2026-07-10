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
