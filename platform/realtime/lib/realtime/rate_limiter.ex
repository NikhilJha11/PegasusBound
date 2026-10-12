defmodule Realtime.RateLimiter do
  @moduledoc """
  Redis-backed rate limiting with sliding window algorithm.

  Supports four categories:
  - `ws_message`: Messages sent to client (120/min default)
  - `ws_connect`: Socket handshakes (30/min default)
  - `ws_join`: Channel join attempts (30/min default)
  - `ws_event`: Client-sent events (60/min default)

  `ws_connect` and `ws_join` are separate buckets on purpose: they used to share
  one, so a reconnect storm spent the budget a client then needed to rejoin its
  topics with (and vice versa).

  Implements fail-open behavior - if Redis is unavailable,
  rate limiting is bypassed to prevent service disruption.
  """

  require Logger

  alias Realtime.Redis

  @categories %{
    ws_message: 120,
    ws_connect: 30,
    ws_join: 30,
    ws_event: 60
  }

  @burst_multiplier 1.5
  @window_seconds 60

  @doc """
  Check if a request is allowed under rate limiting.

  Accepts an optional custom limit that overrides the default.
  This allows subscription-tier based rate limiting.

  Returns:
  - {:ok, remaining} if allowed
  - {:error, :rate_limited, retry_after_ms} if rate limited

  Fails open if Redis is unavailable.
  """
  def check(user_id, category, custom_limit \\ nil) when is_atom(category) do
    limit = custom_limit || get_limit(category)
    burst_limit = trunc(limit * @burst_multiplier)
    key = rate_limit_key(user_id, category)

    case counter().incr_with_ttl(key, @window_seconds) do
      nil ->
        # Redis unavailable, fail open
        Logger.debug("Rate limiter: Redis unavailable, allowing request")
        {:ok, limit}

      count when count <= burst_limit ->
        {:ok, burst_limit - count}

      _count ->
        {:error, :rate_limited, retry_after_ms()}
    end
  end

  @doc """
  Check rate limit and execute function if allowed.
  Accepts an optional custom limit.
  """
  def with_rate_limit(user_id, category, fun, custom_limit \\ nil) do
    case check(user_id, category, custom_limit) do
      {:ok, _remaining} ->
        fun.()

      {:error, :rate_limited, retry_after_ms} ->
        {:error, :rate_limited, retry_after_ms}
    end
  end

  @doc """
  Get current usage for a user and category.
  Returns {current_count, limit} or nil if unavailable.
  """
  def usage(user_id, category) do
    key = rate_limit_key(user_id, category)
    limit = get_limit(category)

    case Redis.get(key) do
      nil -> {0, limit}
      count when is_binary(count) -> {String.to_integer(count), limit}
      _ -> nil
    end
  end

  @doc """
  Reset rate limit for a user and category.
  """
  def reset(user_id, category) do
    key = rate_limit_key(user_id, category)
    Redis.delete(key)
  end

  @doc """
  Get the limit for a category.
  """
  def get_limit(category) do
    config_key =
      case category do
        :ws_message -> :rate_limit_ws_message
        :ws_connect -> :rate_limit_ws_connect
        :ws_join -> :rate_limit_ws_join
        :ws_event -> :rate_limit_ws_event
        _ -> nil
      end

    if config_key do
      Application.get_env(:realtime, config_key, Map.get(@categories, category))
    else
      Map.get(@categories, category, 60)
    end
  end

  @doc """
  Get all configured limits.
  """
  def limits do
    Enum.into(@categories, %{}, fn {cat, _default} ->
      {cat, get_limit(cat)}
    end)
  end

  # Private functions

  # The counter backend is swappable so the limiting logic can be exercised
  # without a live Redis (tests, and any future in-memory single-node mode).
  defp counter, do: Application.get_env(:realtime, :rate_limit_counter, Redis)

  defp rate_limit_key(user_id, category) do
    # Fixed window: the bucket is the wall-clock minute.
    minute = div(System.system_time(:second), 60)
    "rl:ws:#{user_id}:#{category}:#{minute}"
  end

  # Milliseconds until the current bucket rolls over, which is exactly when
  # budget is available again. The old version scaled the wait by how far over
  # the limit the caller was and got it backwards: the worst offender was told
  # to come back SOONEST (60s/overage), so a client honouring the hint retried
  # hardest at the moment it was least welcome.
  defp retry_after_ms do
    window_ms = @window_seconds * 1000
    window_ms - rem(System.system_time(:millisecond), window_ms)
  end
end
