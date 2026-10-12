defmodule RealtimeWeb.BulkChannelTest do
  @moduledoc """
  A bulk operation id is not backed by a table this service can read, so the join
  cannot prove ownership and delivery is gated instead. Without that gate any
  authenticated user could join `bulk:<id>` and watch another account's import.
  """

  use RealtimeWeb.ChannelCase, async: false

  alias RealtimeWeb.BulkChannel

  defp progress_event(user_id, operation_id) do
    %{
      "event_type" => "BULK_PROGRESS",
      "user_id" => user_id,
      "operation_id" => operation_id,
      "processed_items" => 40,
      "total_items" => 100
    }
  end

  defp broadcast(operation_id, event) do
    Phoenix.PubSub.broadcast(Realtime.PubSub, "bulk:#{operation_id}", {:pubsub_event, event})
  end

  test "the owner receives their operation's progress" do
    op = uuid()
    {:ok, _, _socket} = subscribe_and_join(user_socket("owner"), BulkChannel, "bulk:#{op}")

    broadcast(op, progress_event("owner", op))

    assert_push("BULK_PROGRESS", %{"processed_items" => 40})
  end

  test "another user joined to the same operation receives nothing" do
    op = uuid()
    {:ok, _, _socket} = subscribe_and_join(user_socket("snooper"), BulkChannel, "bulk:#{op}")

    broadcast(op, progress_event("owner", op))

    refute_push("BULK_PROGRESS", _payload, 100)
  end

  test "an event with no owner is delivered to nobody" do
    op = uuid()
    {:ok, _, _socket} = subscribe_and_join(user_socket("owner"), BulkChannel, "bulk:#{op}")

    broadcast(op, %{"event_type" => "BULK_PROGRESS", "operation_id" => op})
    broadcast(op, %{"event_type" => "BULK_PROGRESS", "operation_id" => op, "user_id" => ""})

    refute_push("BULK_PROGRESS", _payload, 100)
  end

  test "a malformed operation id is refused with a topic code" do
    assert {:error, payload} =
             subscribe_and_join(user_socket("owner"), BulkChannel, "bulk:not-a-uuid")

    assert payload.code == 4005
    assert payload.reason == "invalid_operation_id"
  end

  describe "own_event?/2" do
    test "matches only the owning socket" do
      socket = user_socket("owner")

      assert BulkChannel.own_event?(%{"user_id" => "owner"}, socket)
      refute BulkChannel.own_event?(%{"user_id" => "someone-else"}, socket)
      refute BulkChannel.own_event?(%{"user_id" => ""}, socket)
      refute BulkChannel.own_event?(%{"user_id" => nil}, socket)
      refute BulkChannel.own_event?(%{}, socket)
    end
  end
end
