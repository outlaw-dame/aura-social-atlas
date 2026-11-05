defmodule Bonfire.RelayClient.AdminTest do
  use ExUnit.Case, async: false

  alias Bonfire.RelayClient
  alias Bonfire.RelayClient.{Admin, Config}
  alias Bonfire.RelayClient.Store.Memory
  alias Bonfire.RelayClient.Test.{FakeAuthorizer, FakeFederation}

  @public "https://www.w3.org/ns/activitystreams#Public"
  @tag_url "https://relay.fedi.buzz/tag/knitting"
  @inst_url "https://relay.fedi.buzz/instance/fluffy.family"
  @masto "https://relay.masto.example/actor"

  setup do
    Application.put_env(:bonfire_relay_client, :test_pid, self())
    Application.put_env(:bonfire_relay_client, :test_objects, %{})
    Application.put_env(:bonfire_relay_client, :test_fail, [])
    Application.delete_env(:bonfire_relay_client, :test_on_follow)
    Application.delete_env(:bonfire_relay_client, :test_resolve)
    {:ok, srv} = start_supervised(Memory)

    {:ok, cfg} =
      Config.validate(
        enabled: true,
        outbound_enabled: true,
        allowed_relay_hosts: ["relay.fedi.buzz", "relay.masto.example"]
      )

    ctx = %{
      config: cfg,
      store: {Memory, srv},
      federation: FakeFederation,
      authorizer: FakeAuthorizer,
      actor: %{admin: true, name: "alice"}
    }

    %{ctx: ctx, srv: srv}
  end

  defp add_tag!(ctx, opts \\ %{}) do
    {:ok, c} = Admin.add_connection(ctx, Map.merge(%{kind: :fedibuzz_tag, tag: "#Knitting"}, opts))
    c
  end

  describe "RBAC (server-side on every call)" do
    test "non-admins and anonymous are refused everywhere", %{ctx: ctx} do
      for actor <- [nil, %{admin: false}, %{}] do
        c = %{ctx | actor: actor}
        assert {:error, :forbidden} = Admin.overview(c)
        assert {:error, :forbidden} = Admin.add_connection(c, %{kind: :fedibuzz_tag, tag: "x1"})
        assert {:error, :forbidden} = Admin.enable(c, @tag_url)
        assert {:error, :forbidden} = Admin.disable(c, @tag_url)
        assert {:error, :forbidden} = Admin.remove(c, @tag_url, confirm: @tag_url)
        assert {:error, :forbidden} = Admin.update_connection(c, @tag_url, %{})
        assert {:error, :forbidden} = Admin.add_tag_rule(c, %{tags: ["a1"]})
        assert {:error, :forbidden} = Admin.add_domain_rule(c, %{domain: "a.example"})
        assert {:error, :forbidden} = Admin.set_rule_enabled(c, "x", true)
        assert {:error, :forbidden} = Admin.delete_rule(c, "x", confirm: "x")
      end

      refute_received {:resolve, _}
      refute_received {:follow, _, _, _}
    end

    test "missing authorizer fails closed", %{ctx: ctx} do
      assert {:error, :forbidden} = Admin.overview(Map.delete(ctx, :authorizer))
    end
  end

  describe "FediBuzz connections" do
    test "add resolves the actor and stays idle; nothing is sent", %{ctx: ctx} do
      c = add_tag!(ctx)
      assert_received {:resolve, @tag_url}
      refute_received {:follow, _, _, _}
      assert c.state == :idle and c.kind == :fedibuzz_tag and c.topic == "knitting"
      assert c.protocol == :fedibuzz and c.outbound_enabled == false
      assert c.created_by == "alice"
    end

    test "unresolvable or mismatching actor is refused (no assumption)", %{ctx: ctx} do
      Application.put_env(:bonfire_relay_client, :test_resolve, fn _ -> {:error, :not_found} end)
      assert {:error, :unresolvable_actor} = Admin.add_connection(ctx, %{kind: :fedibuzz_tag, tag: "x1"})

      Application.put_env(:bonfire_relay_client, :test_resolve, fn _ ->
        {:ok, %{id: "https://relay.fedi.buzz/tag/other", inbox: "https://relay.fedi.buzz/inbox"}}
      end)

      assert {:error, :actor_path_mismatch} = Admin.add_connection(ctx, %{kind: :fedibuzz_tag, tag: "x1"})
    end

    test "allowlist, input validation, outbound refused for FediBuzz", %{ctx: ctx} do
      assert {:error, :relay_not_allowlisted} =
               Admin.add_connection(ctx, %{kind: :fedibuzz_tag, tag: "x1", host: "evil.example"})

      assert {:error, :invalid_hashtag} = Admin.add_connection(ctx, %{kind: :fedibuzz_tag, tag: "no way"})
      assert {:error, :invalid_kind} = Admin.add_connection(ctx, %{kind: :bogus, url: @masto})

      assert {:error, :fedibuzz_is_inbound_only} =
               Admin.add_connection(ctx, %{kind: :fedibuzz_instance, domain: "fluffy.family", outbound_enabled: true})

      assert {:error, {:invalid, :max_per_minute}} =
               Admin.add_connection(ctx, %{kind: :fedibuzz_tag, tag: "x1", max_per_minute: 0})
    end

    test "enable sends a server Follow of the resolved topic actor; Accept activates", %{ctx: ctx} do
      add_tag!(ctx)
      assert {:ok, %{state: :pending} = c} = Admin.enable(ctx, @tag_url)
      local = FakeFederation.local()
      assert_received {:follow, ^local, @tag_url, @tag_url}

      # buzzrelay Accepts with the topic actor and embeds our Follow
      acc = %{"type" => "Accept", "actor" => @tag_url,
              "object" => %{"id" => c.follow_id, "type" => "Follow", "actor" => local, "object" => @tag_url}}
      assert {:ok, %{state: :accepted}} = RelayClient.handle_incoming(%{signer: @tag_url, activity: acc}, ctx)
    end

    test "Announce from topic relay: fetched from origin, on-topic only, no follow graph", %{ctx: ctx} do
      add_tag!(ctx)
      {:ok, c} = Admin.enable(ctx, @tag_url)
      acc = %{"type" => "Accept", "actor" => @tag_url, "object" => c.follow_id}
      {:ok, _} = RelayClient.handle_incoming(%{signer: @tag_url, activity: acc}, ctx)

      on = "https://knit.example/notes/1"
      off = "https://knit.example/notes/2"

      Application.put_env(:bonfire_relay_client, :test_objects, %{
        on => %{"id" => on, "type" => "Note", "attributedTo" => "https://knit.example/u/a", "to" => [@public],
                "tag" => [%{"type" => "Hashtag", "name" => "#Knitting"}]},
        off => %{"id" => off, "type" => "Note", "attributedTo" => "https://knit.example/u/a", "to" => [@public]}
      })

      ann = fn id, n -> %{"id" => "https://relay.fedi.buzz/announce/#{n}", "type" => "Announce", "actor" => @tag_url,
                          "to" => [@public], "object" => id} end

      assert {:ok, _} = RelayClient.handle_incoming(%{signer: @tag_url, activity: ann.(on, 1)}, ctx)
      assert_received {:ingest, ^on, opts}
      assert opts[:no_follow_graph] and opts[:trusted_relay] == false and opts[:relayed_by] == @tag_url

      assert {:drop, :off_topic} = RelayClient.handle_incoming(%{signer: @tag_url, activity: ann.(off, 2)}, ctx)
      refute_received {:ingest, ^off, _}
    end

    test "rate limit sheds load per connection", %{ctx: ctx} do
      add_tag!(ctx, %{max_per_minute: 2})
      {:ok, c} = Admin.enable(ctx, @tag_url)
      {:ok, _} = RelayClient.handle_incoming(%{signer: @tag_url, activity: %{"type" => "Accept", "actor" => @tag_url, "object" => c.follow_id}}, ctx)

      results =
        for n <- 1..4 do
          RelayClient.handle_incoming(%{signer: @tag_url, activity: %{"id" => "https://relay.fedi.buzz/a/#{n}", "type" => "Announce", "actor" => @tag_url, "to" => [@public], "object" => "https://k.example/n/#{n}"}}, ctx)
        end

      assert Enum.count(results, &(&1 == {:drop, :rate_limited})) == 2
    end
  end

  describe "connection lifecycle" do
    test "disable sends Undo, stops inbound; remove needs disable + typed confirmation", %{ctx: ctx, srv: srv} do
      add_tag!(ctx)
      {:ok, c} = Admin.enable(ctx, @tag_url)
      {:ok, _} = RelayClient.handle_incoming(%{signer: @tag_url, activity: %{"type" => "Accept", "actor" => @tag_url, "object" => c.follow_id}}, ctx)

      assert {:error, :disable_first} = Admin.remove(ctx, @tag_url, confirm: @tag_url)
      assert {:ok, %{state: :idle}} = Admin.disable(ctx, @tag_url)
      fid = c.follow_id
      assert_received {:unfollow, _, @tag_url, ^fid}

      ann = %{"id" => "https://relay.fedi.buzz/a/x", "type" => "Announce", "actor" => @tag_url, "to" => [@public], "object" => "https://k.example/n/1"}
      assert {:drop, :subscription_inactive} = RelayClient.handle_incoming(%{signer: @tag_url, activity: ann}, ctx)

      assert {:error, :confirmation_required} = Admin.remove(ctx, @tag_url, confirm: "yes")
      assert {:error, :confirmation_required} = Admin.remove(ctx, @tag_url, [])
      assert :ok = Admin.remove(ctx, @tag_url, confirm: @tag_url)
      assert Memory.get_by_relay_actor(srv, @tag_url) == nil
    end

    test "failed Follow records error; retry mints a fresh Follow id", %{ctx: ctx, srv: srv} do
      add_tag!(ctx)
      Application.put_env(:bonfire_relay_client, :test_fail, [:follow])
      assert {:error, {:follow_failed, :queue_down}} = Admin.enable(ctx, @tag_url)
      failed = Memory.get_by_relay_actor(srv, @tag_url)
      assert failed.state == :failed and failed.last_error == "queue_down" and failed.error_count == 1
      assert {:ok, %{state: :pending} = again} = Admin.retry(ctx, @tag_url)
      assert again.follow_id != failed.follow_id
    end

    test "Accept for the OLD follow id after retry is refused (replay)", %{ctx: ctx} do
      add_tag!(ctx)
      Application.put_env(:bonfire_relay_client, :test_fail, [:follow])
      {:error, _} = Admin.enable(ctx, @tag_url)
      old = Memory.get_by_relay_actor(elem(ctx.store, 1), @tag_url).follow_id
      {:ok, _} = Admin.retry(ctx, @tag_url)
      acc = %{"type" => "Accept", "actor" => @tag_url, "object" => old}
      assert {:error, :unknown_follow} = RelayClient.handle_incoming(%{signer: @tag_url, activity: acc}, ctx)
    end

    test "concurrent enable sends exactly one Follow", %{ctx: ctx} do
      add_tag!(ctx)

      results =
        1..20
        |> Task.async_stream(fn _ -> Admin.enable(ctx, @tag_url) end)
        |> Enum.map(fn {:ok, r} -> r end)

      assert Enum.count(results, &match?({:ok, _}, &1)) == 1
      assert_received {:follow, _, _, _}
      refute_received {:follow, _, _, _}
    end

    test "enable refused while the feature is switched off", %{ctx: ctx} do
      add_tag!(ctx)
      off = %{ctx | config: %{ctx.config | enabled: false}}
      assert {:error, :feature_disabled} = Admin.enable(off, @tag_url)
      refute_received {:follow, _, _, _}
    end

    test "Accept arriving while disabled does not resurrect the connection", %{ctx: ctx} do
      add_tag!(ctx)
      {:ok, c} = Admin.enable(ctx, @tag_url)
      {:ok, _} = Admin.disable(ctx, @tag_url)
      acc = %{"type" => "Accept", "actor" => @tag_url, "object" => c.follow_id}
      assert {:error, {:invalid_transition, :idle, :accepted}} =
               RelayClient.handle_incoming(%{signer: @tag_url, activity: acc}, ctx)
    end

    test "outbound never goes to FediBuzz and respects per-connection outbound", %{ctx: ctx} do
      add_tag!(ctx)
      {:ok, c} = Admin.enable(ctx, @tag_url)
      {:ok, _} = RelayClient.handle_incoming(%{signer: @tag_url, activity: %{"type" => "Accept", "actor" => @tag_url, "object" => c.follow_id}}, ctx)

      {:ok, _} = Admin.add_connection(ctx, %{kind: :mastodon, url: @masto})
      {:ok, m} = Admin.enable(ctx, @masto)
      {:ok, _} = RelayClient.handle_incoming(%{signer: @masto, activity: %{"type" => "Accept", "actor" => @masto, "object" => m.follow_id}}, ctx)

      pub = %{"id" => "https://fedizen.example/a/1", "type" => "Create", "actor" => "https://fedizen.example/u/x",
              "to" => [@public], "object" => %{"id" => "https://fedizen.example/n/1", "to" => [@public]}}

      assert {:ok, %{delivered: [], skipped: skipped}} = RelayClient.outbound(pub, "fedizen.example", ctx)
      assert {"https://relay.fedi.buzz/inbox", :fedibuzz_is_inbound_only} in skipped
      assert {"https://relay.masto.example/inbox", :outbound_disabled_for_connection} in skipped

      {:ok, _} = Admin.update_connection(ctx, @masto, %{outbound_enabled: true})
      assert {:ok, %{delivered: ["https://relay.masto.example/inbox"]}} = RelayClient.outbound(pub, "fedizen.example", ctx)
    end
  end

  describe "rules admin" do
    test "add, pause, delete with confirmation; coverage reported", %{ctx: ctx} do
      {:ok, r} = Admin.add_tag_rule(ctx, %{tags: ["#Knitting", "crochet"], mode: :all})
      {:ok, d} = Admin.add_domain_rule(ctx, %{domain: "fluffy.family", mode: :whole_instance})
      assert r.created_by == "alice"
      {:ok, o} = Admin.overview(ctx)
      assert {:no_source, _} = o.coverage[r.id]
      assert {:no_source, :needs_accepted_fedibuzz_instance_connection} = o.coverage[d.id]

      {:ok, _} = Admin.set_rule_enabled(ctx, r.id, false)
      {:ok, o} = Admin.overview(ctx)
      assert {:disabled, _} = o.coverage[r.id]

      assert {:error, :confirmation_required} = Admin.delete_rule(ctx, r.id, confirm: "nope")
      assert :ok = Admin.delete_rule(ctx, r.id, confirm: r.id)
      {:ok, o} = Admin.overview(ctx)
      assert Enum.map(o.rules, & &1.id) == [d.id]
    end

    test "client-supplied rule id is ignored (no overwrite of others)", %{ctx: ctx} do
      {:ok, a} = Admin.add_tag_rule(ctx, %{tags: ["aa"]})
      {:ok, b} = Admin.add_tag_rule(ctx, %{tags: ["bb"], id: a.id})
      assert a.id != b.id
    end
  end
end
