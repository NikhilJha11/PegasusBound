defmodule RealtimeWeb.Presence do
  @moduledoc """
  Phoenix.Presence for org-level collaboration.

  Tracks which members are online per `org:<id>` topic, with display metadata
  (name, avatar) and a lightweight activity descriptor (page, resource,
  action) that clients update as they navigate — e.g. `resource:
  "thread:<id>", action: "replying"` powers the "Mate is replying" indicator
  in the unibox and the live-collaborator stack in the automation builder.

  API-key (developer) sockets are never tracked: machines are not teammates.
  """

  use Phoenix.Presence,
    otp_app: :realtime,
    pubsub_server: Realtime.PubSub
end
