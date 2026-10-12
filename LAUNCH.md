# Pegasusbound launch checklist

Work through this top to bottom before opening public sign-ups. Items marked ⚠ are not optional for a public product that sends email on users' behalf.

## 1. Infrastructure

- [ ] Domain live: `app.<domain>` (dashboard), `api.<domain>` (backend), `t.<domain>` (tracking/unsubscribe links), `ws.<domain>` (realtime). See `platform/deploy/nginx/pegasusbound.conf`.
- [ ] TLS on every host.
- [ ] ⚠ Managed Postgres 16 with automated daily backups and point-in-time recovery. Set `PRIMARY_DB`. The intelligence layer lives in the `intel` schema of the same database, so one backup covers both.
- [ ] Redis and NATS persistent volumes (compose defaults), or managed equivalents.
- [ ] Images built from this repo and pushed to **your** registry. Set `PEGASUSBOUND_IMAGE_PREFIX`. Upstream images are never pulled; the auto-updater is removed.
- [ ] At least 2 workers for sending throughput (`docker compose up --scale worker=2`).

## 2. Secrets (all in `platform/.env`; copy from `deploy/config/env.example`)

- [ ] ⚠ `AUTH_SECRET` (≥32 chars, same value as realtime `JWT_SECRET`)
- [ ] ⚠ `CREDENTIALS_ENCRYPTION_KEY` (`openssl rand -hex 32`). **Back it up.** Losing it makes every connected mailbox unrecoverable.
- [ ] ⚠ `KMS_LOCAL_MASTER_KEY` (`make gen-key`). **Back it up.**
- [ ] ⚠ `INTEL_SECRET` (`openssl rand -hex 32`). **Back it up.** It encrypts Company Brain and CRM credentials and per-workspace engine keys.
- [ ] ⚠ `INTERNAL_API_TOKEN` (long random). It signs every backend→intelligence request.
- [ ] `SECRET_KEY_BASE` (≥64 chars)
- [ ] ⚠ `ANTHROPIC_API_KEY`, with `INTEL_LLM_MODE=anthropic`
- [ ] `DEPLOYMENT_MODE=cloud` for open sign-up and email verification
- [ ] Gmail / Microsoft OAuth apps for mailbox connection (`BOX_GOOGLE_*`, `BOX_OUTLOOK_*`). Google's restricted-scope verification can take weeks: start now.
- [ ] Transactional email relay for sign-up codes and invites (SMTP settings in env.example)
- [ ] Billing: `BILLING_PROVIDER=stripe` plus Stripe keys, if you charge at launch

## 3. Product checks (run on staging with real mailboxes you own)

- [ ] Sign up, verify email, create a workspace
- [ ] Connect a mailbox; warm-up starts
- [ ] Intelligence → Turn on (mints the workspace engine key)
- [ ] Brain & CRM → connect the Company Brain MCP; connect Attio (`https://mcp.attio.com/mcp`, OAuth). The capabilities list shows green.
- [ ] New AI campaign → CSV of **your own test addresses** → plan appears → edit a draft → approve
- [ ] Emails arrive with correct merge fields and an unsubscribe link; follow-ups thread; replying stops the sequence
- [ ] A reply appears in Leads & inbox with a classification; a positive reply creates an Attio task and note
- [ ] Unsubscribe link → address suppressed → no further sends
- [ ] Batch evaluates → learning appears in Memory → next experiment starts within limits
- [ ] Pause and resume stop and start the underlying platform campaigns

## 4. Legal and deliverability ⚠

- [ ] Terms of Service, Privacy Policy and a Data Processing Agreement (you process your users' prospects' personal data: GDPR/UK GDPR)
- [ ] Acceptable-use policy that forbids purchased lists and spam, with enforcement (the platform has org risk scoring in `internal/app/orgrisk`)
- [ ] Sub-processor list (Anthropic for the LLM, your hosting, Stripe…)
- [ ] SPF, DKIM and DMARC on your own sending domains; tell users to set them on theirs (the platform's deliverability checks surface this)

## 5. Operations

- [ ] Error tracking: set `SENTRY_DSN` (web and backend)
- [ ] Uptime checks on `api.<domain>/health` and the intelligence sidecar's health (it reports failed and overdue jobs)
- [ ] Alerts on Postgres disk, worker queue depth and bounce-rate spikes
- [ ] Runbook: who gets paged; how to pause all sending (`pegasusboundctl`)

## 6. Decisions only you can make

- [ ] **Pricing.** Plans and prices are inherited placeholders (Starter $23, Grow $71, Business $263 per month, billed annually). They're defined in `platform/web/src/lib/plans.ts` (display) and `platform/internal/seed/plans.go` (plans and limits), and have to match your Stripe products.
- [ ] **Marketing site and docs.** `platform/site` and `platform/docs` are rebranded text, but they still contain inherited product, pricing and roadmap copy. Review them before publishing, or don't deploy them yet.
- [ ] **Assistant name.** The in-app AI assistant is called "Remie" (inherited). Keep or rename (`web/src/components/app/agent`).

## Found in the local end-to-end test (2026-10-12)

- **Cloud mode.** `DEPLOYMENT_MODE=cloud` is required for the public product. Self-hosted mode shows a "SELF-HOSTED" badge, a "Pegasusbound Cloud" warm-up upsell and a hosted-plans pitch, all meant for people running their own copy.
- **Sending hours.** AI campaigns send inside the campaign window (default weekdays 08:00–18:00 in the timezone chosen in the wizard) **and** each mailbox's own working-hours profile. A new campaign launched in the evening starts the next working morning. That's intended.
- **Address verification.** The platform refuses addresses whose domain has no mail servers (`invalid: no MX records`) and parks a campaign whose list is mostly undeliverable. Test with real addresses you own, not `.test` or `example.com`.
- **Unencrypted SMTP is refused** before any credentials are sent. Mailboxes need SSL/TLS or STARTTLS.

## Known limits at launch

- **Company Brain and CRM matching:** Attio and Brain MCP responses are matched by tool name and shape. Test with your real servers; the capability list on Brain & CRM shows what was detected.
- **Learning curve:** the learning loop needs volume. Batches of 50 rarely produce a confident winner. The engine says so instead of guessing, and moves on after enough evidence.
- **No RL fine-tuning yet:** learning uses Bayesian bandits plus memory. A learned scorer and reward model are the next stage, once reply data accumulates.
