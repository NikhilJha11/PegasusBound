defmodule Realtime.RateLimiterTest do
  use ExUnit.Case, async: false

  alias Realtime.RateLimiter
  alias Realtime.Test.Counter

  setup do
    Counter.reset()
    :ok
  end

  describe "check/3" do
    test "allows up to the burst ceiling, then refuses" do
      # burst ceiling is 1.5x the limit
      for n <- 1..15 do
        assert {:ok, _remaining} = RateLimiter.check("u1", :ws_join, 10), "call #{n} refused"
      end

      assert {:error, :rate_limited, retry_after_ms} = RateLimiter.check("u1", :ws_join, 10)
      assert retry_after_ms > 0
    end

    test "the retry hint points at the next window, and does not shrink as overage grows" do
      window_ms = 60_000

      for _ <- 1..15, do: RateLimiter.check("u1", :ws_join, 10)

      bucket_before = div(System.system_time(:second), 60)
      {:error, :rate_limited, first} = RateLimiter.check("u1", :ws_join, 10)

      # 200 more refusals: the hint must still be the time left in this window,
      # never a shorter wait because the caller misbehaved harder.
      for _ <- 1..200, do: RateLimiter.check("u1", :ws_join, 10)
      {:error, :rate_limited, later} = RateLimiter.check("u1", :ws_join, 10)
      bucket_after = div(System.system_time(:second), 60)

      assert first > 0 and first <= window_ms
      assert later > 0 and later <= window_ms
      # Only the clock moved between the two, so the hint may shrink by the
      # elapsed time and nothing else. (Unless the window itself rolled over
      # mid-test, in which case the hint legitimately jumps back up.)
      if bucket_before == bucket_after do
        assert later <= first
        assert first - later < 1_000
      end
    end

    test "reports the remaining burst allowance" do
      assert {:ok, 14} = RateLimiter.check("u1", :ws_join, 10)
      assert {:ok, 13} = RateLimiter.check("u1", :ws_join, 10)
    end

    test "budgets are per user" do
      for _ <- 1..15, do: RateLimiter.check("noisy", :ws_join, 10)
      assert {:error, :rate_limited, _} = RateLimiter.check("noisy", :ws_join, 10)

      assert {:ok, _} = RateLimiter.check("quiet", :ws_join, 10)
    end

    test "ws_connect and ws_join do not share a bucket" do
      # A reconnect storm must not spend the budget the client then needs to
      # rejoin its topics with.
      for _ <- 1..15, do: RateLimiter.check("u1", :ws_connect, 10)
      assert {:error, :rate_limited, _} = RateLimiter.check("u1", :ws_connect, 10)

      assert {:ok, _} = RateLimiter.check("u1", :ws_join, 10)
    end

    test "falls open when the counter backend is unavailable" do
      Counter.simulate_outage(true)

      for _ <- 1..100 do
        assert {:ok, _} = RateLimiter.check("u1", :ws_join, 10)
      end
    end

    test "uses the configured default when no custom limit is given" do
      # ws_join defaults to 30/min, so the burst ceiling is 45.
      for _ <- 1..45, do: assert({:ok, _} = RateLimiter.check("u1", :ws_join))
      assert {:error, :rate_limited, _} = RateLimiter.check("u1", :ws_join)
    end

    test "a plan-specific limit overrides the default" do
      for _ <- 1..3, do: assert({:ok, _} = RateLimiter.check("u1", :ws_join, 2))
      assert {:error, :rate_limited, _} = RateLimiter.check("u1", :ws_join, 2)
    end
  end

  describe "get_limit/1" do
    test "knows every category" do
      assert RateLimiter.get_limit(:ws_message) == 120
      assert RateLimiter.get_limit(:ws_connect) == 30
      assert RateLimiter.get_limit(:ws_join) == 30
      assert RateLimiter.get_limit(:ws_event) == 60
    end
  end
end
