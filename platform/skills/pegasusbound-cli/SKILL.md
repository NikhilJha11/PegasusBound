---
name: pegasusbound-cli
description: Use the `pegasusbound` CLI to drive Pegasusbound as a signed-in user - sign in with `pegasusbound auth login`, then work with campaigns, contacts, mailboxes, the unified inbox, analytics, webhooks and the live event stream on the hosted service or any self-hosted instance. Use whenever the task is to operate Pegasusbound the product from a terminal or a script and a `pegasusbound` binary is available. For instance recovery and accounts (database-level), use pegasusbound-ops instead.
---

# Driving Pegasusbound through the `pegasusbound` CLI

`pegasusbound` is the customer CLI: it signs in as a person, holds one credential
per host in `~/.config/pegasusbound`, and speaks only the public REST API. Every
command is bounded by the scopes the sign-in approved.

If the binary is not on PATH, install it without a toolchain or root:

```bash
curl -fsSL https://pegasusbound.com/cli.sh | sh     # macOS, Linux
irm https://pegasusbound.com/cli.ps1 | iex          # Windows
```

Add `-s -- --dir <path>` to place it somewhere specific. It is also inside the
backend image on a self-hosted instance (`docker compose -p pegasusbound exec
backend pegasusbound ...`).

It is not `pegasusboundctl`. That one talks to Postgres and exists for recovery and
accounts (the `pegasusbound-ops` skill). If both are available and the task is
product work, use `pegasusbound`.

## Getting authenticated

Check first, because a non-interactive agent cannot complete a browser flow:

```bash
pegasusbound auth status
```

- **Signed in** (exit 0): carry on.
- **Not signed in** (exit 4): you need a credential. In order of preference:
  1. `PEGASUSBOUND_TOKEN` in the environment. It overrides everything and is never
     written to disk, so it is the right answer for a script or a CI job.
  2. `echo "$KEY" | pegasusbound auth login --with-token`, when a key was supplied.
  3. `pegasusbound auth login`, which needs a human at a browser. Print the code and
     the URL it shows and hand back to the user; do not sit in the poll loop
     waiting for something only they can do.

Set `PEGASUSBOUND_HOST` (or `--host`) for a self-hosted instance, and
`PEGASUSBOUND_API_URL` only when the API is not at `api.<host>`.

Exit code 4 always means the credential: missing, rejected, or short a scope.
`pegasusbound auth status` names which, and where the token came from.

## Output: always ask for JSON

Tables are for humans. Every command takes `--json`, and output is JSON
automatically when stdout is not a terminal, but pass it explicitly so the
shape does not depend on how you were invoked.

```bash
pegasusbound campaign list --json
pegasusbound campaign list --json --all      # every page, cursor followed
pegasusbound contact list --json --limit 100
```

Lists are `{"data": [...], "pagination": {"next_cursor", "has_more"}}`. Page
with `--cursor <next_cursor>`, or let `--all` do it. Cursors are opaque, never
construct one, and a cursor belongs to the ordering it came from: changing the
sort halfway through a walk is rejected, not silently reordered.

## Command map

`pegasusbound <command> --help` lists subcommands; `pegasusbound <command> <sub> --help`
gives the arguments and flags. Ids are positional, not flags.

| Command | Covers |
|---|---|
| `status` | one call for "what is happening": mailboxes needing attention, what is sending, what is unread |
| `campaign` | list, view, create, edit, delete, steps, senders, segments, preflight, test, start, stop, logs, plan, pause-lead / resume-lead, lead-cc / set-lead-cc / lead-cc-suggestions |
| `contact` | list, view, create, edit, delete, lookup, timeline, emails, notes, import, imports, import-status, import-start, import-cancel, export, verify |
| `mailbox` | list, view, edit, check, sync, skip-folders, identity, refresh-identity, behavior, warmup, hold, release, send |
| `inbox` | list, view, thread, read, reply, compose, drafts, scheduled, snooze |
| `suppression` | the list of addresses and domains that get no campaign mail |
| `segment`, `template`, `automation`, `form` | audiences, reply templates, automations, lead capture |
| `deal`, `pipeline`, `task` | the CRM |
| `analytics`, `audit`, `advisor` | numbers, the audit trail, recommendations |
| `placement` | inbox placement tests: overview, test, list, view, cancel, seed inboxes, a campaign's scheduled test, batches across many mailboxes, fleet coverage |
| `webhook`, `key`, `oauth-app`, `integration` | the developer surface |
| `org`, `team`, `settings`, `warmup-routing` | the workspace surface a key can reach |
| `tool` | the AI tool registry, listed and called |
| `events tail` | the live event stream |
| `api` | any endpoint at all |

Anything without a command is reachable through the passthrough. Paths are
relative to `/v1`:

```bash
pegasusbound api "/campaigns?limit=10" --paginate
pegasusbound api /contacts -f email=jane@example.com -f first_name=Jane
pegasusbound api /campaigns/CAMPAIGN_ID -X PATCH -F daily_limit=40
pegasusbound api /contacts/search -X POST --input filter.json
```

`-f` keeps a string, `-F` guesses the type (`true`, `null`, numbers, `@file`),
`key[sub]=v` nests, repeated `key[]=v` builds an array.

## Sending safety, read before anything that sends

These put real mail on the wire and prompt before doing so:
`campaign start`, `campaign test`, `placement test`, `placement batch-start`,
`mailbox send`, `inbox reply`, `inbox compose`, `inbox approve-draft`.
Everything else is safe to run freely.

- With no terminal they refuse rather than send. `--yes` is what proceeds, so
  **only pass `--yes` when the user asked for that specific send.** Never add
  it globally to be rid of prompts.
- Run `pegasusbound campaign preflight CAMPAIGN_ID` before `campaign start` and act
  on what it reports. It costs nothing and catches missing senders, empty
  audiences and broken tracking.
- When a campaign sends less than expected, `pegasusbound campaign plan CAMPAIGN_ID`
  is the answer: today's projected sends and every limit that lowered them
  (easing out of warmup, the campaign limit, other campaigns on the same
  mailboxes, the plan's allowance, leads due). Read it before touching a cap.
- Never raise a mailbox's daily cap casually. The default is 50 campaign
  emails per mailbox per day with 600 seconds between sends; a fresh mailbox
  starts around 10-20. Do not go above 50 unless the user asked and the
  mailbox has the history to justify it.
- Keep warmup running on mailboxes that campaign. Do not stop warmup because a
  campaign started.
- To stop emailing ONE contact for a while, use `pegasusbound campaign pause-lead
  CAMPAIGN_ID CONTACT_ID --until 2026-09-21T17:00:00Z`, not an unsubscribe and
  not the suppression list: both of those are workspace-wide and permanent.
  `resume-lead` lifts it. Pegasusbound already writes the same hold by itself when a
  recipient answers with an out-of-office auto-reply, in every campaign that
  contact is a lead of, so do not also pause a lead that reads `paused` for
  that reason.
- To reach two people at one company in ONE thread, copy the second on the
  first lead's emails: `pegasusbound campaign set-lead-cc CAMPAIGN_ID CONTACT_ID
  --cc COLLEAGUE_ID` (at most two; `lead-cc-suggestions` lists likely
  colleagues). Do not enrol both as leads of the same campaign for this: a
  copied contact's own lead is held anyway, and `resume-lead` on that hold
  sends them a second thread. Every copy is a recipient who did not ask for
  the email, so keep it to small, personal campaigns.
- If deliverability shows rising bounces or complaints, stop the campaign and
  report. Do not push volume into a degrading mailbox.
- To check where copy lands before a launch, `pegasusbound placement test --mailbox
  MAILBOX_ID --campaign CAMPAIGN_ID --step STEP_ID` sends one copy to each seed
  inbox, every one counted against that mailbox's daily limit; `placement view
  TEST_ID` reads the result. One test is a signal, not a verdict: compare a few
  before rewriting copy, and `--tracking compare` isolates open and click
  tracking.
- To check a whole fleet, `pegasusbound placement batch-preview` with the same flags
  as `batch-start` states the mailboxes, tests, copies and credits first; show
  that to the user before starting. `batch-start --scope campaign
  --scope-campaign CAMPAIGN_ID` (or `--scope workspace`, narrowed with
  `--only-provider`, `--only-domain`, `--untested-days`, and sampled with
  `--sample`) runs one test per mailbox, a few at a time, over hours.
  `placement batch BATCH_ID` groups the result by sending domain and provider,
  and `batch-senders BATCH_ID` lists mailboxes worst first: a whole domain low
  is that domain, one mailbox low on a healthy domain is that mailbox.

## Errors

Failures print the API's `code` and `request_id` to stderr. Branch on `code`
(`not_found`, `forbidden`, `rate_limit_exceeded`, ...) and quote `request_id`
when reporting. On `rate_limit_exceeded`, wait the `Retry-After` it names.

For a write you retry, pass `--idempotency-key <same-key>` so a retry cannot
double-apply. Any unique string works; reuse it only for the identical retry.

Exit codes: `0` worked, `1` failed, `2` bad command line or a prompt with no
terminal, `4` credential.

## Watching what happens

```bash
pegasusbound events tail --json --intent EMAIL
```

Streams the live event stream as newline-delimited JSON. Needs a key with
`REALTIME_SUBSCRIBE`. Useful for confirming a send actually went out; give it
`--count N` so it terminates rather than running forever.

## What this CLI cannot do

- Connect a mailbox. That needs OAuth consent or a credential form in a
  browser: `pegasusbound browse mailboxes --no-browser` prints the URL to hand over.
- Manage members, roles, invitations, workspace exports or billing. Every
  `/organization/*` and `/subscription/*` route is session-only and refuses an
  API key, so there is no command for them. `pegasusbound browse settings
  --no-browser` prints the URL to hand over.
- Create accounts, reset passwords, grant platform admin, back up or restore an
  instance. That is `pegasusboundctl` and the `pegasusbound-ops` skill.
