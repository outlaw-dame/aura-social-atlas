defmodule Bonfire.RelayClientTest do
  use ExUnit.Case, async: false

  alias Bonfire.RelayClient
  alias Bonfire.RelayClient.{Config, Subscription}
  alias Bonfire.RelayClient.Store.Memory
  alias Bonfire.RelayClient.Test.FakeFederation, as: Fed

  @public "https://www.w3.org/ns/activitystreams#Public"
  @masto "https://relay.masto.example/actor"
  @lite "https://relay.lite.example/relay"

  setup do
    Application.put_env(:bonfire_relay_client, :test_pid, self())
    Application.put_env(:bonfire_relay_client, :test_objects, %{})
    {:ok, srv} = start_supervised(Memory)

    {:ok, cfg} =
      Config.validate(
        enabled: true,
        outbound_enabled: true,
        allowed_relay_hosts: ["relay.masto.example", "relay.lite.example"]
      )

    %{ctx: %{config: cfg, store: {Memory, srv}, federation: Fed}, srv: srv}
  end

  defp sub!(ctx, relay, proto) do
    {:ok, s} = RelayClient.subscribe(relay, proto, ctx)
    s
  end

  defp accept!(ctx, s) do
    {:ok, s} =
      RelayClient.handle_incoming(
        %{signer: s.relay_actor_id,
          activity: %{"id" => s.relay_actor_id <> "#a", "type" => "Accept", "actor" => s.relay_actor_id,
                      "object" => s.follow_id}},
        ctx
      )

    s
  end

  defp note(id, actor, to \\ [@public]) do
    %{"id" => id, "type" => "Note", "attributedTo" => actor, "to" => to, "content" => "hi"}
  end

  describe "disabled" do
    test "does nothing when off", %{ctx: ctx} do
      ctx = %{ctx | config: %{ctx.config | enabled: false}}
      assert {:error, :disabled} = RelayClient.subscribe(@masto, :mastodon, ctx)
      assert :not_handled = RelayClient.handle_incoming(%{signer: @masto, activity: %{}}, ctx)
      refute_received {:follow, _, _, _}
    end
  end

  describe "Mastodon protocol" do
    test "Follow targets as:Public, Accept activates", %{ctx: ctx} do
      s = sub!(ctx, @masto, :mastodon)
      assert_received {:follow, _, @masto, @public}
      assert s.state == :pending
      assert accept!(ctx, s).state == :accepted
    end

    test "Accept embedding a Follow of the relay actor (LitePub shape) is refused", %{ctx: ctx} do
      s = sub!(ctx, @masto, :mastodon)
      a = %{"type" => "Accept", "actor" => @masto,
            "object" => %{"id" => s.follow_id, "type" => "Follow", "object" => @masto}}
      assert {:error, :unknown_follow} = RelayClient.handle_incoming(%{signer: @masto, activity: a}, ctx)
    end

    test "Reject moves to rejected and is terminal", %{ctx: ctx, srv: srv} do
      s = sub!(ctx, @masto, :mastodon)
      r = %{"type" => "Reject", "actor" => @masto, "object" => s.follow_id}
      assert {:ok, %{state: :rejected}} = RelayClient.handle_incoming(%{signer: @masto, activity: r}, ctx)
      a = %{"type" => "Accept", "actor" => @masto, "object" => s.follow_id}
      assert {:error, {:invalid_transition, :rejected, :accepted}} =
               RelayClient.handle_incoming(%{signer: @masto, activity: a}, ctx)
      assert Memory.get_by_relay_actor(srv, @masto).state == :rejected
    end

    test "Mastodon relay sending Follow is a protocol mismatch", %{ctx: ctx} do
      s = accept!(ctx, sub!(ctx, @masto, :mastodon))
      f = %{"id" => "#{@masto}/f", "type" => "Follow", "actor" => @masto, "object" => s.local_actor_id}
      assert {:error, :protocol_mismatch} = RelayClient.handle_incoming(%{signer: @masto, activity: f}, ctx)
      refute_received {:accept, _, _}
    end

    test "Undo (unsubscribe) sends Undo via adapter and ends removed", %{ctx: ctx} do
      s = accept!(ctx, sub!(ctx, @masto, :mastodon))
      assert {:ok, %{state: :removed}} = RelayClient.unsubscribe(@masto, ctx)
      assert_received {:unfollow, _, @masto, fid} when fid == s.follow_id
    end
  end

  describe "LitePub protocol" do
    test "Follow targets relay actor; reciprocal Follow accepted once", %{ctx: ctx} do
      s = sub!(ctx, @lite, :litepub)
      assert_received {:follow, _, @lite, @lite}
      s = accept!(ctx, s)
      f = %{"id" => "#{@lite}/follows/1", "type" => "Follow", "actor" => @lite, "object" => Fed.local()}
      assert {:ok, %{reciprocal_follow_id: "https://relay.lite.example/relay/follows/1"}} =
               RelayClient.handle_incoming(%{signer: @lite, activity: f}, ctx)
      assert_received {:accept, _, _}
      # replayed reciprocal follow: idempotent, no second Accept
      assert {:ok, _} = RelayClient.handle_incoming(%{signer: @lite, activity: f}, ctx)
      refute_received {:accept, _, _}
      assert s.protocol == :litepub
    end

    test "reciprocal Follow from another actor on the relay is refused", %{ctx: ctx} do
      accept!(ctx, sub!(ctx, @lite, :litepub))
      f = %{"id" => "x", "type" => "Follow", "actor" => "https://relay.lite.example/other", "object" => Fed.local()}
      assert {:error, :invalid_reciprocal_follow} = RelayClient.handle_incoming(%{signer: @lite, activity: f}, ctx)
    end

    test "relay Undo of its reciprocal Follow ends subscription", %{ctx: ctx} do
      accept!(ctx, sub!(ctx, @lite, :litepub))
      f = %{"id" => "#{@lite}/follows/9", "type" => "Follow", "actor" => @lite, "object" => Fed.local()}
      {:ok, _} = RelayClient.handle_incoming(%{signer: @lite, activity: f}, ctx)
      u = %{"type" => "Undo", "actor" => @lite, "object" => f["id"]}
      assert {:ok, %{state: :rejected}} = RelayClient.handle_incoming(%{signer: @lite, activity: u}, ctx)
    end

    test "Announce: object re-fetched from origin, only id used", %{ctx: ctx} do
      accept!(ctx, sub!(ctx, @lite, :litepub))
      oid = "https://author.example/notes/1"
      Application.put_env(:bonfire_relay_client, :test_objects, %{oid => note(oid, "https://author.example/u/a")})
      ann = %{"id" => "#{@lite}/ann/1", "type" => "Announce", "actor" => @lite, "to" => [@public],
              "object" => %{"id" => oid, "content" => "FORGED", "attributedTo" => "https://victim.example/u"}}
      assert {:ok, _} = RelayClient.handle_incoming(%{signer: @lite, activity: ann}, ctx)
      assert_received {:fetch, ^oid}
      assert_received {:ingest, ^oid, opts}
      assert opts[:trusted_relay] == false and opts[:relayed_by] == @lite
    end

    test "fetched object that is not public / wrong origin is dropped", %{ctx: ctx} do
      accept!(ctx, sub!(ctx, @lite, :litepub))
      a = "https://author.example/notes/2"
      b = "https://author.example/notes/3"
      Application.put_env(:bonfire_relay_client, :test_objects, %{
        a => note(a, "https://author.example/u/a", ["https://author.example/u/a/followers"]),
        b => note(b, "https://other.example/u/x")
      })
      for {oid, why} <- [{a, :not_public}, {b, :origin_mismatch}] do
        ann = %{"id" => "#{@lite}/ann/#{why}", "type" => "Announce", "actor" => @lite, "to" => [@public], "object" => oid}
        assert {:drop, ^why} = RelayClient.handle_incoming(%{signer: @lite, activity: ann}, ctx)
      end
      refute_received {:ingest, _, _}
    end
  end

  describe "inbound safety" do
    setup %{ctx: ctx} do
      accept!(ctx, sub!(ctx, @masto, :mastodon))
      :ok
    end

    defp create(id, actor, to, obj_to) do
      %{"id" => id, "type" => "Create", "actor" => actor, "to" => to,
        "object" => note(String.replace(id, "/activity", ""), actor, obj_to)}
    end

    test "followers-only / direct / missing recipients never ingested", %{ctx: ctx} do
      actor = "https://author.example/u/a"
      for {to, n} <- [{["#{actor}/followers"], 1}, {["https://x.example/u/b"], 2}, {[], 3}] do
        c = create("https://author.example/n/#{n}/activity", actor, to, to)
        assert {:drop, :not_public} = RelayClient.handle_incoming(%{signer: @masto, activity: c}, ctx)
      end
      # public activity wrapping a private object
      c = create("https://author.example/n/4/activity", actor, [@public], ["#{actor}/followers"])
      assert {:drop, :not_public} = RelayClient.handle_incoming(%{signer: @masto, activity: c}, ctx)
      refute_received {:ingest, _, _}
    end

    test "forged actor without LD signature is re-fetched, not trusted", %{ctx: ctx} do
      actor = "https://victim.example/u/v"
      c = create("https://victim.example/n/1/activity", actor, [@public], [@public])
      assert {:error, :not_found} = RelayClient.handle_incoming(%{signer: @masto, activity: c}, ctx)
      assert_received {:fetch, "https://victim.example/n/1"}
      refute_received {:ingest, _, _}
    end

    test "LD-verified original from its own origin is ingested", %{ctx: ctx} do
      actor = "https://author.example/u/a"
      c = create("https://author.example/n/5/activity", actor, [@public], [@public])
      env = %{signer: @masto, activity: c, ld_verified_actor: actor}
      assert {:ok, _} = RelayClient.handle_incoming(env, ctx)
      assert_received {:ingest, "https://author.example/n/5/activity", _}
    end

    test "LD signature from a different actor does not count", %{ctx: ctx} do
      actor = "https://author.example/u/a"
      c = create("https://author.example/n/6/activity", actor, [@public], [@public])
      env = %{signer: @masto, activity: c, ld_verified_actor: "https://author.example/u/other"}
      RelayClient.handle_incoming(env, ctx)
      assert_received {:fetch, _}
    end

    test "cross-origin object or spoofed attributedTo dropped", %{ctx: ctx} do
      c = %{"id" => "https://author.example/act/7", "type" => "Create", "actor" => "https://author.example/u/a",
            "to" => [@public], "object" => note("https://other.example/n/7", "https://author.example/u/a")}
      assert {:drop, :origin_mismatch} = RelayClient.handle_incoming(%{signer: @masto, activity: c}, ctx)
      c2 = %{c | "object" => note("https://author.example/n/8", "https://author.example/u/b")}
      assert {:drop, :spoofed_attribution} = RelayClient.handle_incoming(%{signer: @masto, activity: c2}, ctx)
    end

    test "duplicates and replays are processed once", %{ctx: ctx} do
      actor = "https://author.example/u/a"
      c = create("https://author.example/n/9/activity", actor, [@public], [@public])
      env = %{signer: @masto, activity: c, ld_verified_actor: actor}
      assert {:ok, _} = RelayClient.handle_incoming(env, ctx)
      assert {:drop, :duplicate} = RelayClient.handle_incoming(env, ctx)
    end

    test "concurrent duplicates: exactly one wins", %{ctx: ctx} do
      actor = "https://author.example/u/a"
      c = create("https://author.example/n/10/activity", actor, [@public], [@public])
      env = %{signer: @masto, activity: c, ld_verified_actor: actor}
      results =
        1..20 |> Task.async_stream(fn _ -> RelayClient.handle_incoming(env, ctx) end) |> Enum.map(fn {:ok, r} -> r end)
      assert Enum.count(results, &match?({:ok, _}, &1)) == 1
    end

    test "stale activities rejected", %{ctx: ctx} do
      actor = "https://author.example/u/a"
      c = create("https://author.example/n/11/activity", actor, [@public], [@public])
            |> Map.put("published", "2001-01-01T00:00:00Z")
      assert {:drop, :stale_or_future} = RelayClient.handle_incoming(%{signer: @masto, activity: c}, ctx)
    end

    test "signer that is not a subscribed relay is not handled", %{ctx: ctx} do
      assert :not_handled =
               RelayClient.handle_incoming(%{signer: "https://evil.example/actor", activity: %{"type" => "Accept"}}, ctx)
    end

    test "Accept from relay host but different actor refused", %{ctx: ctx} do
      a = %{"type" => "Accept", "actor" => "https://relay.masto.example/other", "object" => "x"}
      assert {:error, :actor_mismatch} = RelayClient.handle_incoming(%{signer: @masto, activity: a}, ctx)
    end
  end

  describe "subscribe guards" do
    test "allowlist, protocol and duplicates", %{ctx: ctx} do
      assert {:error, :relay_not_allowlisted} = RelayClient.subscribe("https://evil.example/actor", :mastodon, ctx)
      assert {:error, :invalid_protocol} = RelayClient.subscribe(@masto, :activitypub, ctx)
      assert {:error, :invalid_url} = RelayClient.subscribe("http://relay.masto.example/actor", :mastodon, ctx)
      sub!(ctx, @masto, :mastodon)
      assert {:error, :already_subscribed} = RelayClient.subscribe(@masto, :mastodon, ctx)
    end

    test "state machine" do
      s = %Subscription{relay_actor_id: "a", relay_inbox: "b", relay_host: "c", protocol: :mastodon, follow_id: "d"}
      assert {:error, _} = Subscription.transition(s, :unsubscribing)
      {:ok, s} = Subscription.transition(s, :accepted)
      {:ok, s} = Subscription.transition(s, :unsubscribing)
      {:ok, s} = Subscription.transition(s, :removed)
      assert {:error, _} = Subscription.transition(s, :accepted)
    end
  end

  describe "outbound" do
    test "only public local activities go to accepted Mastodon relays", %{ctx: ctx} do
      accept!(ctx, sub!(ctx, @masto, :mastodon))
      accept!(ctx, sub!(ctx, @lite, :litepub))
      local = "fedizen.example"
      pub = %{"id" => "https://fedizen.example/a/1", "type" => "Create", "actor" => "https://fedizen.example/u/x",
              "to" => [@public], "object" => note("https://fedizen.example/n/1", "https://fedizen.example/u/x")}
      assert {:ok, ["https://relay.masto.example/inbox"]} = RelayClient.outbound(pub, local, ctx)

      fo = %{pub | "to" => ["https://fedizen.example/u/x/followers"]}
      assert {:drop, _} = RelayClient.outbound(fo, local, ctx)
      priv_obj = %{pub | "object" => note("https://fedizen.example/n/2", "x", ["https://fedizen.example/u/x/followers"])}
      assert {:drop, _} = RelayClient.outbound(priv_obj, local, ctx)
      remote = %{pub | "actor" => "https://other.example/u/y", "id" => "https://other.example/a/1"}
      assert {:drop, _} = RelayClient.outbound(remote, local, ctx)
    end

    test "outbound off unless explicitly enabled", %{ctx: ctx} do
      ctx = %{ctx | config: %{ctx.config | outbound_enabled: false}}
      assert {:error, :disabled} = RelayClient.outbound(%{}, "fedizen.example", ctx)
    end
  end
end
