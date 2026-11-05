defmodule Bonfire.RelayClient.ConfigUrlTest do
  use ExUnit.Case, async: true
  alias Bonfire.RelayClient.{Config, URL}

  test "off by default" do
    assert {:ok, %Config{enabled: false, outbound_enabled: false, allowed_relay_hosts: []}} =
             Config.validate([])
  end

  test "rejects bad values" do
    assert {:error, {:invalid_config, :enabled}} = Config.validate(enabled: "yes")
    assert {:error, {:invalid_config, :max_subscriptions}} = Config.validate(max_subscriptions: 0)

    assert {:error, {:invalid_config, :max_subscriptions}} =
             Config.validate(max_subscriptions: 1000)

    assert {:error, {:invalid_config, :allowed_relay_hosts}} =
             Config.validate(allowed_relay_hosts: "x.org")

    assert {:error, {:invalid_config, :allowed_relay_hosts}} =
             Config.validate(allowed_relay_hosts: ["127.0.0.1"])
  end

  test "normalises hosts" do
    assert {:ok, %{allowed_relay_hosts: ["relay.example.org"]}} =
             Config.validate(allowed_relay_hosts: ["Relay.Example.org.", "relay.example.org"])
  end

  test "URL safety" do
    assert {:ok, _, "relay.example.org"} = URL.parse_https("https://relay.example.org/actor")

    for bad <- [
          "http://relay.example.org/actor",
          "https://127.0.0.1/actor",
          "https://[::1]/a",
          "https://localhost/a",
          "https://u:p@relay.example.org/a",
          "https://relay.example.org:8443/a",
          "https://relay.local/a",
          "https://relay.example.org/a#frag",
          "ftp://x.org",
          42
        ] do
      assert {:error, _} = URL.parse_https(bad), "expected reject: #{inspect(bad)}"
    end
  end
end
