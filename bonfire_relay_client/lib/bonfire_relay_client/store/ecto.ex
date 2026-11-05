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
      repo.transaction(fn ->
        case repo.get(Row, sub.relay_actor_id, lock: "FOR UPDATE") do
          %Row{state: s} when s in @live -> repo.rollback(:already_subscribed)
          %Row{} = row -> repo.delete!(row)
          nil -> :ok
        end

        repo.insert!(to_row(sub))
        sub
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

    @impl true
    def mark_seen(repo, activity_id) do
      {n, _} =
        repo.insert_all(
          "bonfire_relay_client_seen",
          [%{activity_id: activity_id, seen_at: DateTime.utc_now()}],
          on_conflict: :nothing,
          conflict_target: :activity_id
        )

      if n == 1, do: :new, else: :duplicate
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
