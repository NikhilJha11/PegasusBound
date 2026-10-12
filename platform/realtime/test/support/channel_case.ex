defmodule RealtimeWeb.ChannelCase do
  @moduledoc """
  Case template for channel tests.

  Builds sockets with `Phoenix.ChannelTest.socket/3`, which skips
  `UserSocket.connect/3` — so these tests never need a token, a database, or a
  Redis. Every test starts with a clean rate-limit counter.
  """

  use ExUnit.CaseTemplate

  import Phoenix.ChannelTest

  @endpoint RealtimeWeb.Endpoint

  using do
    quote do
      import Phoenix.ChannelTest
      import RealtimeWeb.ChannelCase

      @endpoint RealtimeWeb.Endpoint
    end
  end

  setup do
    Realtime.Test.Counter.reset()
    :ok
  end

  @doc """
  A connected socket for `user_id`, as `UserSocket.connect/3` would have left it.
  """
  def user_socket(user_id, assigns \\ %{}) do
    base = %{user_id: user_id, ip_address: "127.0.0.1", auth_type: :jwt, rate_limits: %{}}

    socket(RealtimeWeb.UserSocket, "user_socket:#{user_id}", Map.merge(base, assigns))
  end

  @doc """
  Spend `n` units of this user's channel-join budget without joining anything.
  """
  def exhaust_join_budget(user_id, n) do
    Enum.each(1..n, fn _ -> Realtime.RateLimiter.check(user_id, :ws_join) end)
  end

  @doc """
  A random v4 UUID, for topics whose id only has to parse.
  """
  def uuid, do: UUID.uuid4()
end
