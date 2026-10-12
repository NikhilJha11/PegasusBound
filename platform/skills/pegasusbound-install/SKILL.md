---
name: pegasusbound-install
description: Install, reconfigure, back up, restore, move or uninstall a self-hosted Pegasusbound instance with install.sh and pegasusboundctl backup/restore - the one-command install, its non-interactive flags, generating a .env or compose file without installing, scheduled backups, and moving an instance to another host. Use when the task is to stand up, migrate or tear down an instance, rather than to operate one that is already running.
---

# Installing and moving a Pegasusbound instance

`install.sh` is the front door: it pulls the published release images, writes
`docker-compose.yml` and `.env`, starts the stack and prints the claim link.
Nothing is compiled. `pegasusboundctl backup` and `pegasusboundctl restore` are the
other half: one bundle that moves a whole instance to another host.

```bash
curl -fsSL https://pegasusbound.com/install.sh | sh          # the fast path
curl -fsSL https://pegasusbound.com/install.sh | sh -s -- --wizard   # asks everything
```

## Rule zero: agents should not run the interactive forms

The wizard, the review screen and the demo all need a terminal and read raw
keypresses. Driving them from a script means feeding a pty, and there is no
reason to: every answer is also a flag and a `PEGASUSBOUND_*` variable. Use
`--yes` with flags, and the run is silent, deterministic and idempotent.

```bash
curl -fsSL https://pegasusbound.com/install.sh | sh -s -- --yes \
  --dir /opt/pegasusbound --host pegasusbound.example.com --tls caddy \
  --data-root /mnt/data/pegasusbound --retention-preset minimal \
  --backup-dir /mnt/backups/pegasusbound --version v1.4.2
```

Without a terminal the script says so and falls back to defaults plus
whatever flags it was given, so a forgotten `--yes` degrades rather than
hanging.

## Inspect before you install

Three flags produce output and change nothing. Prefer them over reasoning
about what the install would do.

| Command | Prints |
|---|---|
| `sh install.sh --print-env [flags]` | The exact `.env`, to stdout. Nothing else |
| `sh install.sh --dry-run [flags]` | Every file it would write, each under a `── <path> (mode NNNN)` header |
| `sh install.sh --demo` | The whole thing played, installing nothing. Needs a terminal; not for agents |

`--dry-run` output is greppable but is a display format, not a contract. When
you need one file, use `--print-env` for the `.env` and read the compose file
off disk after a real run.

## The flags

| Flag | Variable | Default |
|---|---|---|
| `--dir` | `PEGASUSBOUND_DIR` | `/opt/pegasusbound` |
| `--host` | `PEGASUSBOUND_HOST` | `localhost` |
| `--tls` | `PEGASUSBOUND_TLS` | `none`, or `caddy`, `proxy` |
| `--data-root` | `PEGASUSBOUND_DATA_ROOT` | `<dir>/data`, or the word `volumes` |
| `--blobs` | `PEGASUSBOUND_BLOBS` | `filesystem`, or `s3` |
| `--database-url` | `PEGASUSBOUND_DATABASE_URL` | bundled Postgres |
| `--redis-url` | `PEGASUSBOUND_REDIS_URL` | bundled Redis |
| `--components` | `PEGASUSBOUND_COMPONENTS` | `full`, or `core` |
| `--version` | `PEGASUSBOUND_VERSION` | the newest release |
| `--channel` | `PEGASUSBOUND_CHANNEL` | `stable`, or `dev` |
| `--registry` | `PEGASUSBOUND_IMAGE_PREFIX` | `ghcr.io/pegasusbound/pegasusbound` |
| `--backup-dir` | `PEGASUSBOUND_BACKUP_DIR` | no scheduled backup |
| `--retention-preset` | | `default`, or `minimal` |
| `--force` | | Install into a directory the script did not create |

## Mechanics that bite

- **Re-running is reconfiguration, not reinstallation.** The script adopts the
  existing `.env`, never regenerates a secret and never moves an existing data
  root. Regenerating `CREDENTIALS_ENCRYPTION_KEY` would make every stored
  mailbox credential permanently unreadable, so it will not do it and neither
  should you.
- **It refuses a non-empty directory it did not create.** That is `--force`,
  and `--force` is a decision about someone else's files.
- **Pin the version in automation.** Without `--version` it resolves the newest
  release at run time, so two hosts provisioned a week apart are two versions.
  The resolved tag is written to `PEGASUSBOUND_TAG` in `.env` either way.
- **Verify what landed.** After the pull the script compares the images against
  the release's published `images.json` and stops on a mismatch. That check is
  skipped for a custom `--registry`, and it says so.
- **The keys are the backup.** `keys-backup.txt` in the install directory holds
  the two unrecoverable ones. It sits on the same disk as the database, so it
  is not a backup until it is copied off the host.
- **`--uninstall` never touches data.** Data removal is `--purge-data`, which
  also deletes the keys that could have opened a backup.

## Checking an install

```bash
cd /opt/pegasusbound
docker compose -p pegasusbound ps
docker compose -p pegasusbound exec backend pegasusboundctl status --json
```

`status --json` has stable keys and always exits 0; read `.summary.error`.
Everything else about a running instance is the `pegasusbound-ops` skill.

## Backing up

One bundle holds the three things that only restore together: the database,
the blob root, and the encryption keys. Any two of the three restore an
instance that looks fine and cannot read its own mailboxes.

```bash
cd /opt/pegasusbound
docker compose -p pegasusbound exec backend pegasusboundctl backup --out /data/blobs/pegasusbound.tar.gz
docker compose -p pegasusbound cp backend:/data/blobs/pegasusbound.tar.gz ./pegasusbound.tar.gz \
  && docker compose -p pegasusbound exec -T backend rm -f /data/blobs/pegasusbound.tar.gz
```

`/data/blobs` is used as the hand-off because it is the one path the container
and the host both see. Delete it there afterwards, as above: `backup` leaves
its own output out of the archive, but a bundle left in the blob root is swept
into the next one. Keep the `&&`: an unguarded cleanup after a failed `cp`
deletes the only copy of the backup. The bundle is 0600 and holds every mailbox credential on the
instance plus the keys that open them; never write it somewhere world-readable
and never print its contents.

`install.sh --wizard` can schedule exactly this (a `backup.sh` and a systemd
timer); `--backup-dir` sets it up non-interactively.

## Moving an instance to another host

```bash
# 1. On the new host
curl -fsSL https://pegasusbound.com/install.sh | sh -s -- --yes --host <new-hostname>

# 2. Copy CREDENTIALS_ENCRYPTION_KEY and KMS_LOCAL_MASTER_KEY from the old
#    .env into the new one, then recreate so they take effect
cd /opt/pegasusbound && docker compose -p pegasusbound up -d

# 3. Restore
docker compose -p pegasusbound cp ./pegasusbound.tar.gz backend:/data/blobs/pegasusbound.tar.gz
docker compose -p pegasusbound exec -T backend pegasusboundctl restore --file /data/blobs/pegasusbound.tar.gz --yes
docker compose -p pegasusbound restart

# 4. Confirm
docker compose -p pegasusbound exec backend pegasusboundctl status --json
```

`restore` replaces everything on the target instance, so `--yes` is skipping a
typed confirmation about destroying data. Do not pass it to a command whose
target you have not just checked.

It refuses outright when the host's keys are not the ones the bundle was
sealed with, and prints the two lines to add to `.env`. Do that rather than
reaching for `--force`: `--force` accepts losing every stored mailbox
credential, permanently, and it is never the right answer to an error message.

## One workspace, not the instance

Moving a single organization between two running instances is
`pegasusboundctl org export` / `org import`, in the `pegasusbound-ops` skill. The two are
not interchangeable: a bundle cannot be applied to one workspace, and a
workspace archive cannot restore an instance.

## Reference

- Install and every flag: https://docs.pegasusbound.com/development/install/
- Where data lives, retention, backups, migration: https://docs.pegasusbound.com/development/data-control/
- Building from source instead: https://docs.pegasusbound.com/development/deployment-guide/
