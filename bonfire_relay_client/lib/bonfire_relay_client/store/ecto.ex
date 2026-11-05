if Code.ensure_loaded?(Ecto.Schema) and Code.ensure_loaded?(Ecto.Query) do
  defmodule Bonfire.RelayClient.Store.Ecto.Row do
    @moduledoc false
    use Ecto.Schema

    @primary_key {:relay_actor_id, :string, autogenerate: false}
    schema "bonfire_relay_client_subscriptions" do
      field(:relay_inbox, :string)
      field(:relay_host, :string)
      field(:protocol, :string)
      field(:kind, :string)
      field(:topic, :string)
      field(:state, :string)
      field(:follow_id, :string)
      field(:reciprocal_follow_id, :string)
      field(:local_actor_id, :string)
      field(:inbound_policy, :string, default: "all_public")
      field(:outbound_enabled, :boolean, default: false)
      field(:max_per_minute, :integer, default: 600)
      field(:created_by, :string)
      field(:last_error, :string)
      field(:error_count, :integer, default: 0)
      timestamps(type: :utc_datetime_usec)
    end
  end

  defmodule Bonfire.RelayClient.Store.Ecto.RuleRow do
    @moduledoc false
    use Ecto.Schema

    @primary_key {:id, :string, autogenerate: false}
    schema "bonfire_relay_client_rules" do
      field(:rule_type, :string)
      field(:tags, {:array, :string}, default: [])
      field(:mode, :string)
      field(:domain, :string)
      field(:domain_mode, :string)
      field(:scope_ids, {:array, :string})
      field(:enabled, :boolean, default: true)
      field(:created_by, :string)
      field(:note, :string)
      timestamps(type: :utc_datetime_usec)
    end
  end

  defmodule Bonfire.RelayClient.Store.Ecto do
    @moduledoc """
    Production store. `server` is the host app's Ecto repo module (e.g.
    `Bonfire.Common.Repo`). Requires both migrations in
    `priv/repo/migrations`. Every multi-writer operation is a single SQL
    statement or a row-locked transaction.
    """
    @behaviour Bonfire.RelayClient.Store
    import Ecto.Query
    alias Bonfire.RelayClient.Subscription
    alias Bonfire.RelayClient.Rules.{DomainRule, TagRule}
    alias Bonfire.RelayClient.Store.Ecto.{Row, RuleRow}

    @live ~w(pending accepted unsubscribing idle)

    @impl true
    def insert_subscription(repo, %Subscription{} = sub) do
      repo.transaction(fn ->
        case repo.get(Row, sub.relay_actor_id, lock: "FOR UPDATE") do
          %Row{state: s} when s in @live -> repo.rollback(:already_subscribed)
          %Row{} = row -> repo.delete!(row)
          nil -> :ok
        end

        # Two first-time inserts race on the primary key; the loser rolls back.
        case repo.insert(to_row(sub), on_conflict: :nothing, conflict_target: :relay_actor_id) do
          {:ok, %Row{inserted_at: %DateTime{}}} -> sub
          _ -> repo.rollback(:already_subscribed)
        end
      end)
    end

    @impl true
    def update_subscription(repo, sub) do
      repo.insert!(to_row(sub),
        on_conflict: {:replace_all_except, [:relay_actor_id, :inserted_at]},
        conflict_target: :relay_actor_id
      )

      {:ok, sub}
    end

    @impl true
    def cas_subscription(repo, expected, %Subscription{} = sub) do
      row = to_row(sub)

      changes =
        row
        |> Map.from_struct()
        |> Map.drop([:__meta__, :relay_actor_id, :inserted_at])
        |> Map.put(:updated_at, DateTime.utc_now())
        |> Enum.to_list()

      {n, _} =
        repo.update_all(
          from(r in Row,
            where:
              r.relay_actor_id == ^sub.relay_actor_id and
                r.state in ^Enum.map(expected, &Atom.to_string/1)
          ),
          set: changes
        )

      if n == 1, do: {:ok, sub}, else: {:error, :conflict}
    end

    @impl true
    def delete_subscription(repo, id) do
      repo.delete_all(from(r in Row, where: r.relay_actor_id == ^id))
      :ok
    end

    @impl true
    def get_by_relay_actor(repo, id), do: repo.get(Row, id) |> from_row()

    @impl true
    def get_by_follow_id(repo, id),
      do: repo.one(from(r in Row, where: r.follow_id == ^id)) |> from_row()

    @impl true
    def list(repo), do: repo.all(from(r in Row, order_by: r.inserted_at)) |> Enum.map(&from_row/1)

    @impl true
    def put_rule(repo, rule) do
      repo.insert!(rule_row(rule),
        on_conflict: {:replace_all_except, [:id, :inserted_at]},
        conflict_target: :id
      )

      {:ok, rule}
    end

    @impl true
    def delete_rule(repo, id) do
      repo.delete_all(from(r in RuleRow, where: r.id == ^id))
      :ok
    end

    @impl true
    def list_rules(repo),
      do: repo.all(from(r in RuleRow, order_by: r.inserted_at)) |> Enum.map(&from_rule/1)

    # One statement, atomic under concurrency: insert a fresh claim, or take
    # over an expired claim; a live claim or a completed row is left alone.
    @claim_sql """
    INSERT INTO bonfire_relay_client_seen (activity_id, status, claimed_until, seen_at)
    VALUES ($1, 'claimed', now() + ($2 * interval '1 millisecond'), now())
    ON CONFLICT (activity_id) DO UPDATE
      SET status = 'claimed', claimed_until = EXCLUDED.claimed_until
      WHERE bonfire_relay_client_seen.status = 'claimed'
        AND bonfire_relay_client_seen.claimed_until < now()
    RETURNING activity_id
    """

    @impl true
    def claim(repo, id, lease_ms) do
      case repo.query!(@claim_sql, [id, lease_ms]) do
        %{num_rows: 1} ->
          :claimed

        _ ->
          case repo.query!(
                 "SELECT status FROM bonfire_relay_client_seen WHERE activity_id = $1",
                 [id]
               ) do
            %{rows: [["done"]]} -> :done
            _ -> :in_flight
          end
      end
    end

    @impl true
    def complete(repo, id) do
      repo.query!(
        "UPDATE bonfire_relay_client_seen SET status = 'done', claimed_until = NULL WHERE activity_id = $1",
        [id]
      )

      :ok
    end

    @impl true
    def release(repo, id) do
      repo.query!(
        "DELETE FROM bonfire_relay_client_seen WHERE activity_id = $1 AND status = 'claimed'",
        [id]
      )

      :ok
    end

    @volume_sql """
    INSERT INTO bonfire_relay_client_volume (relay_actor_id, window_start, count)
    VALUES ($1, $2, 1)
    ON CONFLICT (relay_actor_id, window_start) DO UPDATE
      SET count = bonfire_relay_client_volume.count + 1
    RETURNING count
    """

    @impl true
    def bump_volume(repo, relay_id, window) do
      %{rows: [[n]]} = repo.query!(@volume_sql, [relay_id, window])
      n
    end

    defp to_row(%Subscription{} = s) do
      %Row{
        relay_actor_id: s.relay_actor_id,
        relay_inbox: s.relay_inbox,
        relay_host: s.relay_host,
        protocol: Atom.to_string(s.protocol),
        kind: s.kind && Atom.to_string(s.kind),
        topic: s.topic,
        state: Atom.to_string(s.state),
        follow_id: s.follow_id,
        reciprocal_follow_id: s.reciprocal_follow_id,
        local_actor_id: s.local_actor_id,
        inbound_policy: Atom.to_string(s.inbound_policy),
        outbound_enabled: s.outbound_enabled,
        max_per_minute: s.max_per_minute,
        created_by: s.created_by,
        last_error: s.last_error,
        error_count: s.error_count
      }
    end

    defp from_row(nil), do: nil

    defp from_row(%Row{} = r) do
      %Subscription{
        relay_actor_id: r.relay_actor_id,
        relay_inbox: r.relay_inbox,
        relay_host: r.relay_host,
        protocol: atom(r.protocol, Subscription.protocols()),
        kind: r.kind && atom(r.kind, Subscription.kinds()),
        topic: r.topic,
        state: atom(r.state, Subscription.states()),
        follow_id: r.follow_id,
        reciprocal_follow_id: r.reciprocal_follow_id,
        local_actor_id: r.local_actor_id,
        inbound_policy: atom(r.inbound_policy, Subscription.inbound_policies()),
        outbound_enabled: r.outbound_enabled,
        max_per_minute: r.max_per_minute,
        created_by: r.created_by,
        last_error: r.last_error,
        error_count: r.error_count,
        updated_at: r.updated_at
      }
    end

    # Only ever maps to a known atom; unknown DB values raise instead of
    # creating atoms or being misread.
    defp atom(s, allowed), do: Enum.find(allowed, &(Atom.to_string(&1) == s)) || raise("bad #{s}")

    defp rule_row(%TagRule{} = r) do
      %RuleRow{
        id: r.id,
        rule_type: "tag",
        tags: r.tags,
        mode: Atom.to_string(r.mode),
        scope_ids: scope_ids(r.scope),
        enabled: r.enabled,
        created_by: r.created_by,
        note: r.note
      }
    end

    defp rule_row(%DomainRule{} = r) do
      %RuleRow{
        id: r.id,
        rule_type: "domain",
        tags: r.tags,
        mode: Atom.to_string(r.tag_mode),
        domain: r.domain,
        domain_mode: Atom.to_string(r.mode),
        scope_ids: scope_ids(r.scope),
        enabled: r.enabled,
        created_by: r.created_by,
        note: r.note
      }
    end

    defp scope_ids(:all), do: nil
    defp scope_ids({:connections, ids}), do: ids
    defp scope(nil), do: :all
    defp scope(ids), do: {:connections, ids}

    defp from_rule(%RuleRow{rule_type: "tag"} = r) do
      %TagRule{
        id: r.id,
        tags: r.tags,
        mode: atom(r.mode, [:any, :all]),
        scope: scope(r.scope_ids),
        enabled: r.enabled,
        created_by: r.created_by,
        note: r.note
      }
    end

    defp from_rule(%RuleRow{rule_type: "domain"} = r) do
      %DomainRule{
        id: r.id,
        domain: r.domain,
        mode: atom(r.domain_mode, [:observed, :whole_instance]),
        tags: r.tags,
        tag_mode: atom(r.mode, [:any, :all]),
        scope: scope(r.scope_ids),
        enabled: r.enabled,
        created_by: r.created_by,
        note: r.note
      }
    end
  end
end
