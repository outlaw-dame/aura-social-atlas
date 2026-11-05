if Code.ensure_loaded?(Ecto.Schema) and Code.ensure_loaded?(Ecto.Query) do
  defmodule Bonfire.RelayClient.Store.Ecto.Row do
    @moduledoc false
    use Ecto.Schema

    @primary_key {:relay_actor_id, :string, autogenerate: false}
    schema "bonfire_relay_client_subscriptions" do
      field(:relay_inbox, :string)
      field(:relay_host, :string)
      field(:protocol, :string)
      field(:state, :string)
      field(:follow_id, :string)
      field(:reciprocal_follow_id, :string)
      field(:local_actor_id, :string)
      timestamps(type: :utc_datetime_usec)
    end
  end

  defmodule Bonfire.RelayClient.Store.Ecto do
    @moduledoc """
    Production store. `server` is the host app's Ecto repo module
    (e.g. `Bonfire.Common.Repo`). Requires the migration in
    `priv/repo/migrations`.
    """
    @behaviour Bonfire.RelayClient.Store
    import Ecto.Query
    alias Bonfire.RelayClient.Subscription
    alias Bonfire.RelayClient.Store.Ecto.Row

    @live ~w(pending accepted unsubscribing)

    @impl true
    def insert_subscription(repo, %Subscription{} = sub) do
      # Live rows are protected by a partial unique index; a terminal row for
      # the same relay is replaced so the admin can re-subscribe.
      # Two concurrent first-time inserts race on the primary key; the loser
      # gets {:error, :already_subscribed} instead of a second Follow.
      repo.transaction(fn ->
        case repo.get(Row, sub.relay_actor_id, lock: "FOR UPDATE") do
          %Row{state: s} when s in @live -> repo.rollback(:already_subscribed)
          %Row{} = row -> repo.delete!(row)
          nil -> :ok
        end

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
    def get_by_relay_actor(repo, id), do: repo.get(Row, id) |> from_row()

    @impl true
    def get_by_follow_id(repo, id),
      do: repo.one(from(r in Row, where: r.follow_id == ^id)) |> from_row()

    @impl true
    def list(repo), do: repo.all(Row) |> Enum.map(&from_row/1)

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

    defp to_row(%Subscription{} = s) do
      %Row{
        relay_actor_id: s.relay_actor_id,
        relay_inbox: s.relay_inbox,
        relay_host: s.relay_host,
        protocol: Atom.to_string(s.protocol),
        state: Atom.to_string(s.state),
        follow_id: s.follow_id,
        reciprocal_follow_id: s.reciprocal_follow_id,
        local_actor_id: s.local_actor_id
      }
    end

    defp from_row(nil), do: nil

    defp from_row(%Row{} = r) do
      %Subscription{
        relay_actor_id: r.relay_actor_id,
        relay_inbox: r.relay_inbox,
        relay_host: r.relay_host,
        protocol: String.to_existing_atom(r.protocol),
        state: String.to_existing_atom(r.state),
        follow_id: r.follow_id,
        reciprocal_follow_id: r.reciprocal_follow_id,
        local_actor_id: r.local_actor_id,
        updated_at: r.updated_at
      }
    end
  end
end
