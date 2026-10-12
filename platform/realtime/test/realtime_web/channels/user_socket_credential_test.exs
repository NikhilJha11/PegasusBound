defmodule RealtimeWeb.UserSocketCredentialTest do
  use ExUnit.Case, async: true

  alias RealtimeWeb.UserSocket

  @ticket "eyJhbGciOiJIUzI1NiJ9.e30.sig"

  test "a ws ticket is read from the query string" do
    assert UserSocket.credential(%{"token" => @ticket}, %{}) == {:ok, @ticket}
  end

  test "an API key or OAuth token in the query string is still accepted, deprecated" do
    assert UserSocket.credential(%{"token" => "pgsbd_abc"}, %{}) == {:ok, "pgsbd_abc"}
    assert UserSocket.credential(%{"token" => "wmat_abc"}, %{}) == {:ok, "wmat_abc"}
  end

  test "the header wins over the query string" do
    info = %{x_headers: [{"x-pegasusbound-token", "pgsbd_header"}]}
    assert UserSocket.credential(%{"token" => "pgsbd_query"}, info) == {:ok, "pgsbd_header"}
  end

  test "an API key is read from the x-pegasusbound-token header" do
    info = %{x_headers: [{"x-forwarded-for", "1.2.3.4"}, {"x-pegasusbound-token", "pgsbd_abc"}]}
    assert UserSocket.credential(%{}, info) == {:ok, "pgsbd_abc"}
  end

  test "no credential at all is missing" do
    assert UserSocket.credential(%{}, %{x_headers: []}) == {:error, :missing_token}
    assert UserSocket.credential(%{"token" => ""}, %{}) == {:error, :missing_token}
  end

  test "socket params are filtered from logs" do
    filtered = Phoenix.Logger.filter_values(%{"token" => @ticket, "vsn" => "1.0.0"})
    assert filtered["token"] == "[FILTERED]"
    assert filtered["vsn"] == "1.0.0"
  end
end
