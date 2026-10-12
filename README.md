# Pegasusbound

Self-improving cold outbound. Connect your Company Brain and CRM over MCP, pick an audience, approve a plan once, and Pegasusbound runs controlled experiments, learns from real replies, and writes every next email with what it learned.

```
platform/          The product: Go backend + React dashboard (Apache-2.0 licensed base)
  internal/app/intelsink/          event outbox → intelligence layer
  internal/api/handler/intelligence_proxy.go   /v1/intel/* → intelligence sidecar
  web/src/app/app/intelligence/    AI campaigns, leads inbox, email formats, memory, Brain & CRM
packages/engine/   The intelligence layer (TypeScript): experiments, Bayesian decisions, memory, MCP, Claude
apps/intel/        HTTP sidecar exposing the engine to the backend; runs the job loop
scripts/           rebrand, line-ending normalizer, brand assets
```

## How it fits together

```
Browser ── /v1/* ──► Go backend ──────────────► Postgres (public schema: platform)
                     │  /v1/intel/* (session-authenticated,     ▲
                     │   HMAC-signed org/user identity)         │ intel schema
                     ▼                                          │
                  intel sidecar (Node) ── jobs, experiments, memory ──┘
                     │   ▲
   POST /v1/campaigns│   │ intelligence_event_outbox
   POST /v1/contacts │   │ (sent, reply, bounce, unsubscribe, meeting)
                     ▼   │
                  Go backend → workers → your mailboxes (warm-up, caps, stop-on-reply, unsubscribe)
```

- **Sending:** every experiment arm becomes a native platform campaign with its follow-ups as steps. The platform's mailboxes, warm-up, daily caps, threading, stop-on-reply, unsubscribe and suppression all apply.
- **Learning:** the backend appends campaign events to a durable outbox in Postgres. The sidecar drains it into the learning loop. Nothing is exposed publicly.
- **Tenancy:** every engine row is scoped to a platform organization. The sidecar trusts only identities signed by the backend.
- **Background work:** the first time a workspace turns Intelligence on, the sidecar mints a scoped platform API key with the user's session and stores it encrypted.

## Run it

```bash
cd platform
cp deploy/config/env.example .env      # set the secrets marked below
docker compose up --build -d
```

The dashboard runs at http://localhost:5173, the API at http://localhost:8080, and Mailpit (which catches outbound mail in dev) at http://localhost:18025.

Required for anything public: `AUTH_SECRET`, `CREDENTIALS_ENCRYPTION_KEY`, `KMS_LOCAL_MASTER_KEY`, `INTERNAL_API_TOKEN`, `SECRET_KEY_BASE`, `INTEL_SECRET`, `ANTHROPIC_API_KEY`, a real `PRIMARY_DB`, and `DEPLOYMENT_MODE=cloud` for public sign-ups. See [LAUNCH.md](LAUNCH.md).

## Develop

```bash
npm install
npm test            # engine (incl. full loop, tenant isolation, platform bridge) + sidecar API security
npm run typecheck
cd platform && make dev          # platform dev stack (see platform/README.md)
```

When changing engine tables, run `npm run db:generate`. It also strips drizzle's `"public".` qualifiers, which must stay out because the engine lives in its own schema.

## Licence

`platform/` is built on an Apache License 2.0 codebase. The original `LICENSE` and the [`NOTICE`](platform/NOTICE) of modifications must ship with every distribution.
