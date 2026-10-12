defmodule RealtimeWeb.JoinThrottleTest do
  @moduledoc """
  Every channel spends the `ws_join` budget on each `phx_join`.

  Before this gate existed the budget was only spent on the socket handshake, so
  an established socket could issue unlimited joins — each one an authorization
  query — and one client stuck in a rejoin loop was enough to saturate the
  service.
  """

  use RealtimeWeb.ChannelCase, async: false

  alias Realtime.Test.Counter

  alias RealtimeWeb.AccountChannel
  alias RealtimeWeb.AdminChannel
  alias RealtimeWeb.BulkChannel
  alias RealtimeWeb.CampaignChannel
  alias RealtimeWeb.OrgChannel
  alias RealtimeWeb.UserChannel

  # ws_join defaults to 30/min, burst ceiling 45.
  @over_budget 46

  defp channels(user_id) do
    [
      {UserChannel, "user:#{user_id}"},
      {OrgChannel, "org:#{uuid()}"},
      {CampaignChannel, "campaign:#{uuid()}"},
      {AccountChannel, "account:#{uuid()}"},
      {BulkChannel, "bulk:#{uuid()}"},
      {AdminChannel, "admin:platform"}
    ]
  end

  test "an over-budget join is refused with a retry hint on every channel" do
    for {channel, topic} <- channels("u-throttle") do
      Counter.reset()
      exhaust_join_budget("u-throttle", @over_budget)

      assert {:error, payload} =
               subscribe_and_join(user_socket("u-throttle"), channel, topic),
             "#{inspect(channel)} allowed an over-budget join"

      assert payload.code == 4007
      assert payload.reason == "rate_limited"
      assert payload.category == "ws_join"
      assert payload.retry_after_ms > 0
    end
  end

  test "the throttle refuses before the authorization lookup runs" do
    # Auth would need Postgres, which the suite does not have. Reaching it would
    # surface as a channel crash rather than a clean refusal, so a clean
    # {:error, rate_limited} IS the assertion that the guard runs first.
    exhaust_join_budget("u-order", @over_budget)

    assert {:error, %{reason: "rate_limited"}} =
             subscribe_and_join(user_socket("u-order"), CampaignChannel, "campaign:#{uuid()}")
  end

  test "each join spends exactly one unit of the budget" do
    socket = user_socket("u-count")

    for _ <- 1..3 do
      {:ok, _, _} = subscribe_and_join(socket, UserChannel, "user:u-count")
    end

    assert Counter.count(join_key("u-count")) == 3
  end

  test "a join under budget is allowed" do
    exhaust_join_budget("u-under", 10)

    assert {:ok, _, _} =
             subscribe_and_join(user_socket("u-under"), UserChannel, "user:u-under")
  end

  test "one user's join storm does not refuse another user" do
    exhaust_join_budget("u-noisy", @over_budget)

    assert {:error, %{reason: "rate_limited"}} =
             subscribe_and_join(user_socket("u-noisy"), UserChannel, "user:u-noisy")

    assert {:ok, _, _} =
             subscribe_and_join(user_socket("u-calm"), UserChannel, "user:u-calm")
  end

  test "joins are allowed when the counter backend is down" do
    # Fail open: a Redis outage must not take the dashboard's live updates with it.
    Counter.simulate_outage(true)

    for _ <- 1..50 do
      assert {:ok, _, _} =
               subscribe_and_join(user_socket("u-open"), UserChannel, "user:u-open")
    end
  end

  test "a plan-specific join limit is honoured" do
    socket = user_socket("u-plan", %{rate_limits: %{limit_ws_join_pm: 2}})

    # ceiling is 1.5x2 = 3
    for _ <- 1..3 do
      assert {:ok, _, _} = subscribe_and_join(socket, UserChannel, "user:u-plan")
    end

    assert {:error, %{reason: "rate_limited"}} =
             subscribe_and_join(socket, UserChannel, "user:u-plan")
  end

  defp join_key(user_id) do
    minute = div(System.system_time(:second), 60)
    "rl:ws:#{user_id}:ws_join:#{minute}"
  end
end
