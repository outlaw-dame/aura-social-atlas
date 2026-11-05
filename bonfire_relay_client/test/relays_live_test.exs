defmodule Bonfire.RelayClient.RelaysLiveTest do
  use ExUnit.Case, async: false
  import Phoenix.LiveViewTest

  alias Bonfire.RelayClient.{Admin, Config}
  alias Bonfire.RelayClient.Store.Memory
  alias Bonfire.RelayClient.Test.{FakeAuthorizer, FakeFederation}
  alias Bonfire.RelayClient.Web.RelaysLive

  setup do
    Application.put_env(:bonfire_relay_client, :test_pid, self())
    Application.delete_env(:bonfire_relay_client, :test_resolve)
    {:ok, srv} = start_supervised(Memory)
    {:ok, cfg} = Config.validate(enabled: false, allowed_relay_hosts: ["relay.fedi.buzz"])

    ctx = %{config: cfg, store: {Memory, srv}, federation: FakeFederation,
            authorizer: FakeAuthorizer, actor: %{admin: true, name: "alice"}}

    %{ctx: ctx}
  end

  test "admin sees connections, rules and honest coverage", %{ctx: ctx} do
    {:ok, _} = Admin.add_connection(ctx, %{kind: :fedibuzz_tag, tag: "knitting"})
    {:ok, _} = Admin.add_tag_rule(ctx, %{tags: ["knitting"]})
    html = render_component(RelaysLive, id: "relays", relay_ctx: ctx)
    assert html =~ "https://relay.fedi.buzz/tag/knitting"
    assert html =~ "idle"
    assert html =~ "#knitting"
    assert html =~ "no source"
    assert html =~ "switched off"
    assert html =~ "never appear in anyone"
  end

  test "non-admin gets no data", %{ctx: ctx} do
    {:ok, _} = Admin.add_connection(ctx, %{kind: :fedibuzz_tag, tag: "knitting"})
    html = render_component(RelaysLive, id: "relays", relay_ctx: %{ctx | actor: %{admin: false}})
    assert html =~ "unavailable (forbidden)"
    refute html =~ "relay.fedi.buzz/tag/knitting"
  end
end
