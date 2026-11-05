defmodule Bonfire.RelayClient.Protocol do
  @moduledoc """
  Protocol-specific control-plane rules (FEP-ae0c).

  * Mastodon: we send `Follow{object: as:Public}` to the relay inbox; relay
    answers `Accept`/`Reject` of that Follow. No reciprocal Follow.
  * LitePub: we send `Follow{object: relay actor}`; relay Accepts AND sends a
    reciprocal `Follow{object: our actor}` which we Accept only from the
    pinned relay actor.
  """
  alias Bonfire.RelayClient.{Activity, Subscription}

  def follow_object(:mastodon, _relay_actor_id), do: Activity.public_uri()
  def follow_object(:litepub, relay_actor_id), do: relay_actor_id

  @doc """
  Checks that an Accept/Reject refers to OUR follow for this subscription
  and has the shape of this subscription's protocol. Embedded Follow objects
  are compared, never trusted.
  """
  @spec matches_follow?(Subscription.t(), map(), String.t() | nil) :: boolean()
  def matches_follow?(%Subscription{} = sub, response, local_actor) do
    obj = Activity.object(response)

    cond do
      Activity.id_of(obj) != sub.follow_id ->
        false

      is_map(obj) ->
        Activity.type(obj) in [nil, "Follow"] and
          (is_nil(obj["actor"]) or Activity.id_of(obj["actor"]) == local_actor) and
          (is_nil(obj["object"]) or
             Activity.id_of(obj["object"]) == follow_object(sub.protocol, sub.relay_actor_id))

      true ->
        true
    end
  end

  @doc "Is this a valid LitePub reciprocal follow from the pinned relay?"
  def reciprocal_follow?(%Subscription{protocol: :litepub} = sub, follow, local_actor) do
    Activity.type(follow) == "Follow" and is_binary(follow["id"]) and
      Activity.actor_id(follow) == sub.relay_actor_id and
      Activity.id_of(Activity.object(follow)) == local_actor
  end

  def reciprocal_follow?(_, _, _), do: false
end
