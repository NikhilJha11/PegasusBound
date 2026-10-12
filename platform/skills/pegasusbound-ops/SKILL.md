---
name: pegasusbound-ops
description: Administer and recover a self-hosted Pegasusbound instance with pegasusboundctl's operator commands - instance status and health checks, creating accounts, resetting passwords, granting or revoking platform admin, disabling 2FA, claiming a fresh instance, exporting or importing a workspace. Use when the task is about the instance itself (accounts, access, health, migration) rather than campaigns or contacts.
---

# Operating a Pegasusbound instance with pegasusboundctl

The operator commands talk to the database directly, so they work when
signing in does not. They run wherever `PRIMARY_DB` is set, which in practice
means inside the backend container:

```bash
docker compose -p pegasusbound exec backend pegasusboundctl <command>
make cli ARGS="<command>"          # same thing on a compose install
```

## Start every investigation with status

```bash
docker compose -p pegasusbound exec backend pegasusboundctl status        # prose + exit 1 on errors
docker compose -p pegasusbound exec backend pegasusboundctl status --json # stable keys, always exits 0
make doctor                                                     # the same, wrapped
```

`--json` keys are a contract (only ever appended to); read `.summary.error`
for the verdict and `.next_steps` for the exact commands the situation calls
for. Prefer parsing that over reasoning from the prose.

## The commands

| Task | Command |
|---|---|
| Claim a fresh instance | `pegasusboundctl setup-link` (refuses once accounts exist) |
| Create an account | `pegasusboundctl user create --email you@example.com [--admin]` |
| List accounts / find admins | `pegasusboundctl user list [--admin]` |
| Reset a password | `pegasusboundctl user reset-password --email ...` (prints a link) |
| Grant platform admin | `pegasusboundctl user grant-admin --email ... --role super\|support\|ops\|analyst` |
| Revoke platform admin | `pegasusboundctl user revoke-admin --email ...` |
| Clear a lost authenticator | `pegasusboundctl user disable-2fa --email ...` |
| Hash for unattended bootstrap | `pegasusboundctl hash-password` |
| List workspaces | `pegasusboundctl org list` |
| Move a workspace out | `pegasusboundctl org export --org <id\|slug\|owner-email> --out file.zip` |
| Move a workspace in | `pegasusboundctl org import --org ... --file file.zip --dry-run` first |
| Back the instance up | `pegasusboundctl backup --out /data/blobs/pegasusbound.tar.gz`, then copy it out and delete it |
| Restore one onto this instance | `pegasusboundctl restore --file /data/blobs/pegasusbound.tar.gz` |

## Mechanics that bite

- Prompts need a TTY; pipes need `-T`. `docker compose exec` allocates a TTY
  unless you pass `-T`, so:
  - prompting: `docker compose -p pegasusbound exec backend pegasusboundctl user create --email ...`
  - piping: `printf '%s' "$PW" | docker compose -p pegasusbound exec -T backend pegasusboundctl user create --email ... --password-stdin`
- Passwords are 8-128 characters, the dashboard's own rule.
- `--admin` opens the admin panel on `ADMIN_URL` (port 5174 by default), not
  the dashboard on `APP_URL`.
- Redis down: `setup-link` and link-minting `reset-password` fail; use
  `user reset-password --password-stdin` instead. Everything else degrades to
  a warning and keeps working.
- `org import` always with `--dry-run` first; the report is free and names
  every member whose rows would be reassigned to the owner.
- `org export --with-credentials` produces the most sensitive file the
  product has (every mailbox password and refresh token, sealed only by the
  passphrase you supply). Never write it anywhere world-readable, and never
  echo the passphrase.
- `backup` and `restore` are the INSTANCE-level pair and are not
  interchangeable with `org export`/`org import`: a bundle cannot be applied to
  one workspace, and a workspace archive cannot restore an instance.
- `restore` replaces every organization, user and mailbox on the target. It
  asks for a typed `restore` first; `--yes` skips that, so only pass it to a
  target you have just checked with `status --json`.
- `restore` refuses when the host's `CREDENTIALS_ENCRYPTION_KEY` or
  `KMS_LOCAL_MASTER_KEY` differ from the bundle's, and prints the lines to put
  in `.env`. Do that. `--force` accepts losing every stored mailbox credential
  permanently and is never the right answer to that message.

## Standing an instance up, or moving one

Installing, reconfiguring, backing up on a schedule and moving an instance to
another host is the `pegasusbound-install` skill.

## Interacting with the product itself

Campaigns, contacts, mailboxes, the inbox and settings go through the API
half of pegasusboundctl with an API key. That is the `pegasusbound-api` skill.
