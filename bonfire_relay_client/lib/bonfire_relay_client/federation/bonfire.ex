if Code.ensure_loaded?(ActivityPub) and Code.ensure_loaded?(ActivityPub.Actor) do
  defmodule Bonfire.RelayClient.Federation.Bonfire do
    @moduledoc """
    Production adapter onto `activity_pub` / `bonfire_federate_activitypub`.

    FAIL-CLOSED: anything that needs an upstream hook which does not exist yet
    returns `{:error, {:upstream_hook_required, name}}` instead of guessing.
    No subscription can be created through this adapter until
    `mint_activity_id/1` and `follow/4` are implemented on top of upstream
    hooks, so a half-working relay can never be switched on by accident.
    Only compiles inside a Bonfire host; NOT compiled against upstream here.
    See README "Upstream touchpoints".
    """
    @behaviour Bonfire.RelayClient.Federation

    defp hook(name), do: {:error, {:upstream_hook_required, name}}

    @impl true
    def local_relay_actor do
      case Application.get_env(:bonfire_relay_client, :local_actor_username) do
        u when is_binary(u) ->
          with {:ok, actor} <- ActivityPub.Actor.get_cached(username: u), do: {:ok, actor.ap_id}

        _ ->
          {:error, :local_actor_not_configured}
      end
    end

    @impl true
    def resolve_actor(id) do
      with {:ok, actor} <- ActivityPub.Actor.get_cached_or_fetch(ap_id: id) do
        {:ok, %{id: actor.ap_id, inbox: actor.data["inbox"]}}
      end
    end

    # TODO(upstream #2): ActivityPub.follow/2 mints its own id and sets
    # `object` to the followed actor. Needs `id:` and `object_override:`.
    @impl true
    def mint_activity_id(_local), do: hook(:follow_with_preminted_id)

    @impl true
    def follow(_local, _relay, _object, _follow_id), do: hook(:follow_with_preminted_id)

    @impl true
    def unfollow(local, relay, _follow_id) do
      with {:ok, l} <- ActivityPub.Actor.get_cached(ap_id: local),
           {:ok, r} <- ActivityPub.Actor.get_cached(ap_id: relay) do
        ActivityPub.unfollow(%{actor: l, object: r})
      end
    end

    @impl true
    def accept(local, follow) do
      with {:ok, l} <- ActivityPub.Actor.get_cached(ap_id: local) do
        ActivityPub.accept(%{actor: l, to: [follow["actor"]], object: follow, local: true})
      end
    end

    # TODO(upstream #4): needs a fetch that returns the origin-verified data
    # without side-effect ingestion. Upstream Fetcher.fetch_object_from_id/2
    # also inserts the object, which would bypass Policy.verify_fetched/2.
    @impl true
    def fetch_object(_id), do: hook(:fetch_without_ingest)

    # TODO(upstream #1/#4): Incoming.receive_activity/1 expects an
    # ActivityPub.Object produced by the verified inbox pipeline, not a
    # plain map; a `relayed_by` + "no trust elevation" entry point is needed.
    @impl true
    def ingest(_data, _opts), do: hook(:incoming_relayed_object)

    # TODO(upstream #3): publisher must accept extra recipient inboxes.
    @impl true
    def deliver(_activity, _inboxes), do: hook(:publisher_extra_inboxes)

    # TODO(upstream #5): ActivityPub.announce/2 from the service actor
    # addressed to the relay inbox (extra inbox + as:Public).
    @impl true
    def announce(_local, _object_id, _inbox), do: hook(:service_actor_announce)
  end
end
