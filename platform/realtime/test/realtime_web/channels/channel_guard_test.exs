defmodule RealtimeWeb.ChannelGuardTest do
  use RealtimeWeb.ChannelCase, async: false

  alias RealtimeWeb.ChannelGuard

  describe "check_join/1" do
    test "allows a join under budget" do
      assert :ok = ChannelGuard.check_join(user_socket("u1"))
    end

    test "refuses over budget with the documented rate-limit payload" do
      exhaust_join_budget("u1", 46)

      assert {:error, payload} = ChannelGuard.check_join(user_socket("u1"))
      assert payload.code == 4007
      assert payload.reason == "rate_limited"
      assert payload.category == "ws_join"
      assert payload.retry_after_ms > 0
    end
  end

  describe "join_error/2" do
    test "keeps a published reason slug and adds a code" do
      assert {:error, %{code: 4010, reason: "campaign_not_found"}} =
               ChannelGuard.join_error("campaign_not_found")
    end

    test "a malformed topic is its own class" do
      assert {:error, %{code: 4005, reason: "invalid_campaign_id"}} =
               ChannelGuard.join_error("invalid_campaign_id", :invalid_topic)
    end

    test "an atom reason renders the human-readable message" do
      assert {:error, %{code: 4010, reason: "Not a member of this organization"}} =
               ChannelGuard.join_error(:not_a_member)
    end
  end
end
