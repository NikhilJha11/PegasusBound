import Config

# Development-specific configuration
#
# `code_reloader: true` makes Phoenix recompile changed modules
# in-process on each incoming request — the source is bind-mounted
# into the container via docker-compose.dev.yml, so saves on the host
# show up immediately. Websocket-only sessions don't trigger reloads
# the way HTTP requests do; tickle the endpoint with any HTTP probe
# (e.g. `curl http://localhost:4000/health`) to force a recompile.
config :realtime, RealtimeWeb.Endpoint,
  debug_errors: true,
  code_reloader: true,
  check_origin: false,
  watchers: []

# Development logger
config :logger, :console, format: "[$level] $message\n"

# Disable Sentry in development
config :sentry,
  dsn: nil
