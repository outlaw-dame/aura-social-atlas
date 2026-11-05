defmodule Bonfire.RelayClient.Test.Repo do
  use Ecto.Repo, otp_app: :bonfire_relay_client, adapter: Ecto.Adapters.Postgres
end

defmodule Bonfire.RelayClient.EctoStoreTest do
  @moduledoc """
  Runs the real Ecto store and both migrations against PostgreSQL. Set
  RELAY_CLIENT_PG_URL (e.g. ecto://postgres@127.0.0.1:5544/relay_client_test)
  to run; otherwise these tests are excluded. Uses loopback only.
  """
  use ExUnit.Case, async: false
  @moduletag :pg

  alias Bonfire.RelayClient.{Rules, Subscription}
  alias Bonfire.RelayClient.Store.Ecto, as: Store
  alias Bonfire.RelayClient.Test.Repo

  setup_all do
    url = System.get_env("RELAY_CLIENT_PG_URL")
    Application.put_env(:bonfire_relay_client, Repo, url: url, pool_size: 20, log: false)
    {:ok, _} = Repo.start_link()

    Repo.query!(
      "DROP TABLE IF EXISTS bonfire_relay_client_volume, bonfire_relay_client_rules, bonfire_relay_client_seen, bonfire_relay_client_subscriptions, schema_migrations CASCADE"
    )

    path = Path.join(File.cwd!(), "priv/repo/migrations")
    Ecto.Migrator.run(Repo, path, :up, all: true, log: false)
    :ok
  end

  setup do
    Repo.query!(
      "TRUNCATE bonfire_relay_client_volume, bonfire_relay_client_rules, bonfire_relay_client_seen, bonfire_relay_client_subscriptions"
    )

    :ok
  end

  defp sub(attrs \\ []) do
    struct(
      %Subscription{
        relay_actor_id: "https://relay.fedi.buzz/tag/knitting",
        relay_inbox: "https://relay.fedi.buzz/tag/knitting",
        relay_host: "relay.fedi.buzz",
        protocol: :fedibuzz,
        kind: :fedibuzz_tag,
        topic: "knitting",
        follow_id: nil,
        state: :idle,
        local_actor_id: "https://fedizen.example/actor"
      },
      attrs
    )
  end

  test "migrations round-trip (down and up again)" do
    path = Path.join(File.cwd!(), "priv/repo/migrations")
    Ecto.Migrator.run(Repo, path, :down, all: true, log: false)
    Ecto.Migrator.run(Repo, path, :up, all: true, log: false)
    assert %{rows: [[2]]} = Repo.query!("SELECT count(*) FROM schema_migrations")
  end

  test "subscription round-trip incl. enums and nullable follow id" do
    {:ok, _} =
      Store.insert_subscription(Repo, sub(max_per_minute: 42, inbound_policy: :rules_only))

    got = Store.get_by_relay_actor(Repo, "https://relay.fedi.buzz/tag/knitting")
    assert got.state == :idle and got.kind == :fedibuzz_tag and got.protocol == :fedibuzz
    assert got.inbound_policy == :rules_only and got.max_per_minute == 42 and got.follow_id == nil
  end

  test "DB constraints reject invalid states and rates" do
    assert_raise Postgrex.Error, fn ->
      Repo.query!(
        "INSERT INTO bonfire_relay_client_subscriptions (relay_actor_id, relay_inbox, relay_host, protocol, state, inserted_at, updated_at) VALUES ('x','x','x','mastodon','hacked', now(), now())"
      )
    end

    assert_raise Postgrex.Error, fn ->
      Repo.query!(
        "INSERT INTO bonfire_relay_client_subscriptions (relay_actor_id, relay_inbox, relay_host, protocol, state, max_per_minute, inserted_at, updated_at) VALUES ('y','x','x','mastodon','idle', 0, now(), now())"
      )
    end
  end

  test "concurrent first inserts: exactly one wins" do
    results =
      1..20
      |> Task.async_stream(fn _ -> Store.insert_subscription(Repo, sub()) end,
        max_concurrency: 20
      )
      |> Enum.map(fn {:ok, r} -> r end)

    assert Enum.count(results, &match?({:ok, _}, &1)) == 1
  end

  test "CAS: concurrent idle→pending only one wins" do
    {:ok, s} = Store.insert_subscription(Repo, sub())

    results =
      1..20
      |> Task.async_stream(
        fn n ->
          Store.cas_subscription(Repo, [:idle], %{
            s
            | state: :pending,
              follow_id: "https://fedizen.example/f/#{n}"
          })
        end,
        max_concurrency: 20
      )
      |> Enum.map(fn {:ok, r} -> r end)

    assert Enum.count(results, &match?({:ok, _}, &1)) == 1
    assert Store.get_by_relay_actor(Repo, s.relay_actor_id).state == :pending
  end

  test "claims: concurrent claim has one owner; release retries; done is final" do
    results =
      1..20
      |> Task.async_stream(fn _ -> Store.claim(Repo, "https://a.example/act/1", 60_000) end,
        max_concurrency: 20
      )
      |> Enum.map(fn {:ok, r} -> r end)

    assert Enum.count(results, &(&1 == :claimed)) == 1
    assert Enum.count(results, &(&1 == :in_flight)) == 19
    Store.release(Repo, "https://a.example/act/1")
    assert :claimed = Store.claim(Repo, "https://a.example/act/1", 60_000)
    Store.complete(Repo, "https://a.example/act/1")
    Store.release(Repo, "https://a.example/act/1")
    assert :done = Store.claim(Repo, "https://a.example/act/1", 60_000)
  end

  test "expired lease is taken over" do
    assert :claimed = Store.claim(Repo, "lease", 1)
    Process.sleep(20)
    assert :claimed = Store.claim(Repo, "lease", 60_000)
    assert :in_flight = Store.claim(Repo, "lease", 60_000)
  end

  test "volume counter is atomic" do
    1..50
    |> Task.async_stream(fn _ -> Store.bump_volume(Repo, "r", 7) end, max_concurrency: 20)
    |> Stream.run()

    assert Store.bump_volume(Repo, "r", 7) == 51
    assert Store.bump_volume(Repo, "r", 8) == 1
  end

  test "rules round-trip" do
    {:ok, t} =
      Rules.tag_rule(%{
        tags: ["knitting", "café"],
        mode: :all,
        scope: {:connections, ["https://relay.fedi.buzz/tag/knitting"]}
      })

    {:ok, d} = Rules.domain_rule(%{domain: "fluffy.family", mode: :whole_instance, tags: ["art"]})
    Store.put_rule(Repo, t)
    Store.put_rule(Repo, d)
    Store.put_rule(Repo, %{t | enabled: false})
    rules = Store.list_rules(Repo)
    assert Enum.find(rules, &(&1.id == t.id)) == %{t | enabled: false}
    assert Enum.find(rules, &(&1.id == d.id)) == d
    Store.delete_rule(Repo, t.id)
    assert [_] = Store.list_rules(Repo)
  end
end
