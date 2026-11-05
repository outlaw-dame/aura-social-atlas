if Code.ensure_loaded?(ActivityPub) and Code.ensure_loaded?(ActivityPub.Actor) do
  defmodule Bonfire.RelayClient.Federation.Bonfire do
    @moduledoc """
    Production adapter onto `activity_pub` / `bonfire_federate_activitypub`.

    It is capability-gated and FAIL-CLOSED. Every call first checks that the
    upstream hooks from `upstream_patches/` are present (`ActivityPub.RelayHooks.version/0
    == 1` and `Bonfire.Federate.ActivityPub.Incoming.receive_relayed/2`).
    When they are missing, the call returns
    `{:error, {:upstream_hook_required, name}}` and nothing is sent, fetched
    or ingested.

    Calls go through `apply/3` so this module compiles against unpatched
    upstream too. It only compiles inside a Bonfire host and has NOT been
    compiled or run against a patched Bonfire in this repository.
    """
    @behaviour Bonfire.RelayClient.Federation

    @hooks ActivityPub.RelayHooks
    @incoming Bonfire.Federate.ActivityPub.Incoming

    defp hooks_ok?(name) do
      cond do
        not (Code.ensure_loaded?(@hooks) and function_exported?(@hooks, :version, 0) and
                 apply(@hooks, :version, []) == 1) ->
          {:error, {:upstream_hook_required, name}}

        not (Code.ensure_loaded?(@incoming) and function_exported?(@incoming, :receive_relayed, 2)) ->
          {:error, {:upstream_hook_required, :incoming_relayed_object}}

        true ->
          :ok
      end
    end

    defp call(name, fun, args) do
      with :ok <- hooks_ok?(name), do: apply(@hooks, fun, args)
    end

    @impl true
    def local_relay_actor, do: call(:service_actor, :service_actor_id, [])

    @impl true
    def resolve_actor(id) do
      with {:ok, actor} <- ActivityPub.Actor.get_cached_or_fetch(ap_id: id) do
        {:ok, %{id: actor.ap_id, inbox: actor.data["inbox"]}}
      end
    end

    @impl true
    def mint_activity_id(_local), do: call(:follow_with_preminted_id, :mint_activity_id, [])

    @impl true
    def follow(local, relay, object, follow_id) do
      with {:ok, ^local} <- local_relay_actor() || {:error, :not_service_actor},
           {:ok, data} <- call(:follow_with_preminted_id, :follow, [relay, object, follow_id]) do
        {:ok, data}
      else
        {:ok, _other} -> {:error, :not_service_actor}
        e -> e
      end
    end

    @impl true
    def unfollow(_local, relay, follow_id),
      do: call(:follow_with_preminted_id, :undo_follow, [relay, follow_id])

    @impl true
    def accept(_local, follow), do: call(:service_actor_accept, :accept, [follow])

    @impl true
    def fetch_object(id), do: call(:fetch_without_ingest, :fetch_without_ingest, [id])

    @impl true
    def ingest(data, opts) do
      with :ok <- hooks_ok?(:incoming_relayed_object),
           do: apply(@incoming, :receive_relayed, [data, opts])
    end

    @impl true
    def deliver(%{"id" => id}, inboxes),
      do: call(:publisher_extra_inboxes, :deliver_local, [id, inboxes]) |> ok()

    def deliver(_, _), do: {:error, :missing_id}

    @impl true
    def announce(_local, object_id, inbox),
      do: call(:service_actor_announce, :announce, [object_id, inbox]) |> ok()

    defp ok({:ok, _}), do: :ok
    defp ok(e), do: e
  end
end
