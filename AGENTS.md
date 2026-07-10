# Project Engineering Guidelines

## Architecture

- Keep the React entry point under `client/src/app`.
- Organize business code by feature under `client/src/features`.
- Put reusable, business-agnostic UI and transport code under `client/src/shared`.
- Keep DingTalk and third-party browser integrations under `client/src/integrations`.
- Keep Node HTTP routing, database access, repositories, and cloud integrations in separate server modules.
- Shared API contracts belong in `shared/types.ts`; never duplicate them in the client and server.

## React

- Page components compose features; they do not own API clients or cloud SDK calls.
- Stateful business workflows belong in focused hooks or controllers.
- Feature components may depend on shared UI, but shared UI must not import features.
- Do not add business logic to `client/src/App.tsx`.
- Preserve mobile DingTalk WebView behavior and existing accessibility labels.

## Server

- Routes parse HTTP input and format output only.
- Database queries belong in repositories or dedicated database modules.
- Cloud credentials are read only on the server.
- Never silently fall back to local services in production.
- Add a migration for every schema change; do not edit an already-applied migration.

## Verification

- Run `npm run check` before deployment.
- Keep `.env.local` and `.env.production` out of Git.
- Refactors must preserve existing API paths and user-visible behavior unless the task says otherwise.
