if Code.ensure_loaded?(ActivityPub) and Code.ensure_loaded?(ActivityPub.Actor) do
  defmodule Bonfire.RelayClient.Federation.Bonfire do
    @moduledoc """
    Production adapter onto `activity_pub` / `bonfire_federate_activitypub`.

    UNVERIFIED: this module only compiles inside a Bonfire host and has not
    been compiled against upstream in this repository. Signatures were read
    from upstream `main` (ActivityPub.follow/2, unfollow/2, accept/2,
    Actor.get_cached/1, Federator.Fetcher.fetch_object_from_id/2,
    Bonfire.Federate.ActivityPub.Incoming.receive_activity/1). See README
    "Upstream touchpoints" for the two places a Bonfire patch is required.
    """
    @behaviour Bonfire.RelayClient.Federation

    @public "https://www.w3.org/ns/activitystreams#Public"

    @impl true
    def local_relay_actor do
      # Bonfire has a service actor for instance-level federation; configure it
      # explicitly rather than guessing.
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

    @impl true
    def follow(local, relay, object) do
      with {:ok, l} <- ActivityPub.Actor.get_cached(ap_id: local),
           {:ok, r} <- ActivityPub.Actor.get_cached(ap_id: relay) do
        # Mastodon relays require `object` = as:Public. Upstream ActivityPub.follow
        # sets object to the followed actor, so passing a Public object needs the
        # `:object_override` option added upstream (README touchpoint #2).
        opts = if object == @public, do: [object_override: @public], else: []

        case ActivityPub.follow(%{actor: l, object: r, to: [relay]}, opts) do
          {:ok, %{data: data}} -> {:ok, data}
          other -> other
        end
      end
    end

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

    @impl true
    def fetch_object(id) do
      case ActivityPub.Federator.Fetcher.fetch_object_from_id(id, return_tombstones: false) do
        {:ok, %{data: data}} -> {:ok, data}
        {:ok, %{} = data} -> {:ok, data}
        other -> other
      end
    end

    @impl true
    def ingest(data, opts) do
      Bonfire.Federate.ActivityPub.Incoming.receive_activity(
        Map.put(data, "_relayed_by", Keyword.get(opts, :relayed_by))
      )
    end

    @impl true
    def deliver(_activity, _inboxes) do
      # Requires upstream touchpoint #3 (extra inboxes hook in the publisher).
      {:error, :upstream_publisher_hook_required}
    end
  end
end
