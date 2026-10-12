# systemd units for a Docker-free install

One unit per Pegasusbound process, for a host where the binaries were built from
source and installed under `/opt/pegasusbound`. The step-by-step guide that uses
them is [Deploying without Docker](https://docs.pegasusbound.com/development/bare-metal/).

| Unit | Runs | Reads |
|------|------|-------|
| `pegasusbound-backend.service` | `/opt/pegasusbound/bin/backend` | `/etc/pegasusbound/pegasusbound.env` |
| `pegasusbound-forms.service` | `/opt/pegasusbound/bin/forms` | `/etc/pegasusbound/pegasusbound.env` |
| `pegasusbound-consumer.service` | `/opt/pegasusbound/bin/consumer` | `/etc/pegasusbound/pegasusbound.env` |
| `pegasusbound-tracking.service` | `/opt/pegasusbound/bin/tracking` | `/etc/pegasusbound/pegasusbound.env` |
| `pegasusbound-realtime.service` | `/opt/pegasusbound/realtime/bin/realtime start` | `/etc/pegasusbound/pegasusbound.env` |
| `pegasusbound-worker.service` | `/opt/pegasusbound/bin/worker` | `/etc/pegasusbound/worker.env` |
| `pegasusbound-updater.service` | `/opt/pegasusbound/bin/updater` | `/etc/pegasusbound/updater.env` |

Every unit runs as the unprivileged `pegasusbound` user, may write only under
`/var/lib/pegasusbound` (blob storage), and restarts on failure. Copy them to
`/etc/systemd/system/`, then `systemctl daemon-reload` and
`systemctl enable --now` the ones this host runs. Paths are plain strings, so
`sed` them if you install somewhere other than `/opt/pegasusbound`.

`deploy/config/env.example` is the template for `pegasusbound.env`; the worker env
file is what `POST /api/v1/workers/enroll` returns for an enrollment token.

`pegasusbound-updater.service` is the exception to the unprivileged rule: it runs as
the user who owns the checkout (`deploy` in the unit; change it) and drives
`scripts/upgrade-bare-metal.sh`, which builds unprivileged and then runs
`pegasusbound-install-release.sh` (installed root-owned at
`/usr/local/sbin/pegasusbound-install-release`) through sudo. That installer takes no
arguments, touches only fixed paths and refuses symlinks, and is the single
command to allow in sudoers. `updater.env` holds only `UPDATER_TOKEN` (the
backend's `INTERNAL_API_TOKEN`). See
[Updates](https://docs.pegasusbound.com/development/updates/).
