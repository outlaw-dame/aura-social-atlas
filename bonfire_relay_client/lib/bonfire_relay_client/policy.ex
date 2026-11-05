defmodule Bonfire.RelayClient.Policy do
  @moduledoc """
  Pure data-plane decisions for content arriving FROM a relay and content
  going TO a relay. Never performs I/O.

  Inbound: the HTTP signer has already been verified by Bonfire and is the
  relay actor, so nothing inside the body is authenticated by that signature.
  Therefore:

  * only public content is considered (activity AND object);
  * embedded objects are never ingested on the relay's word: we return
    `{:fetch, object_id}` so the object is re-fetched from its origin, unless
    Bonfire reports a verified LD signature from the original actor;
  * the relay never becomes author/booster: no trust elevation.
  """
  alias Bonfire.RelayClient.{Activity, URL}

  @content_types ~w(Note Article Page Question Event Video Audio Image)
  @forwarded_types ~w(Create Update)

  @type decision ::
          {:fetch, String.t()}
          | {:ingest_verified, map()}
          | {:drop, atom()}

  @doc """
  Decide what to do with a data-plane activity from an ACTIVE subscription.
  `envelope.ld_verified_actor` is the actor id whose LD signature Bonfire
  verified on the body (nil if none / not verified).
  """
  @spec inbound(map(), map(), keyword()) :: decision()
  def inbound(activity, envelope, opts \\ []) do
    relay_host = Keyword.fetch!(opts, :relay_host)
    now = Keyword.get(opts, :now, DateTime.utc_now())

    with :ok <- has_id(activity),
         :ok <- fresh(activity, now, opts),
         :ok <- public(activity) do
      case Activity.type(activity) do
        "Announce" -> announce(activity, relay_host)
        t when t in @forwarded_types -> forwarded(activity, envelope, relay_host)
        _ -> {:drop, :unsupported_type}
      end
    end
  end

  # LitePub / Pleroma-style relay: Announce{object: id}. Only the id is used.
  defp announce(activity, relay_host) do
    with id when is_binary(id) <- Activity.id_of(Activity.object(activity)),
         {:ok, _, host} <- URL.parse_https(id),
         false <- host == relay_host do
      {:fetch, id}
    else
      true -> {:drop, :relay_authored_object}
      _ -> {:drop, :invalid_object_id}
    end
  end

  # Mastodon-style relay forwards the ORIGINAL activity of another actor.
  defp forwarded(activity, envelope, relay_host) do
    actor = Activity.actor_id(activity)
    obj = Activity.object(activity)
    obj_id = Activity.id_of(obj)

    cond do
      not is_binary(actor) or not is_binary(obj_id) -> {:drop, :malformed}
      URL.host(actor) in [nil, relay_host] -> {:drop, :relay_authored_object}
      not URL.same_origin?(actor, obj_id) -> {:drop, :origin_mismatch}
      not URL.same_origin?(actor, activity["id"]) -> {:drop, :origin_mismatch}
      is_map(obj) and not Activity.public?(obj) -> {:drop, :not_public}
      is_map(obj) and Activity.type(obj) not in @content_types -> {:drop, :unsupported_type}
      is_map(obj) and attributed_mismatch?(obj, actor) -> {:drop, :spoofed_attribution}
      Map.get(envelope, :ld_verified_actor) == actor and is_map(obj) -> {:ingest_verified, activity}
      true -> {:fetch, obj_id}
    end
  end

  @doc """
  Validate an object fetched (by Bonfire, from its origin) after a `{:fetch, id}`.
  """
  @spec verify_fetched(map(), String.t()) :: {:ok, map()} | {:drop, atom()}
  def verify_fetched(%{} = obj, requested_id) do
    author = Activity.id_of(obj["attributedTo"] |> List.wrap() |> List.first())

    cond do
      obj["id"] != requested_id -> {:drop, :id_mismatch}
      Activity.type(obj) not in @content_types -> {:drop, :unsupported_type}
      not Activity.public?(obj) -> {:drop, :not_public}
      not is_binary(author) or not URL.same_origin?(author, requested_id) -> {:drop, :origin_mismatch}
      true -> {:ok, obj}
    end
  end

  def verify_fetched(_, _), do: {:drop, :malformed}

  @doc """
  Outbound: may this LOCAL activity be sent to relays? Only public
  Create/Update/Delete/Announce authored on `local_host`, with a public object.
  Followers-only, direct, unlisted-without-Public and remote content: never.
  """
  @spec outbound?(map(), String.t()) :: boolean()
  def outbound?(activity, local_host) do
    obj = Activity.object(activity)

    Activity.type(activity) in ~w(Create Update Delete Announce) and
      Activity.public?(activity) and
      URL.host(Activity.actor_id(activity)) == local_host and
      URL.host(activity["id"]) == local_host and
      (not is_map(obj) or Activity.public?(obj) or Activity.type(obj) == "Tombstone")
  end

  defp attributed_mismatch?(obj, actor) do
    case obj["attributedTo"] do
      nil -> false
      a -> Activity.id_of(a |> List.wrap() |> List.first()) != actor
    end
  end

  defp has_id(%{"id" => id}) when is_binary(id) do
    if URL.host(id), do: :ok, else: {:drop, :invalid_id}
  end

  defp has_id(_), do: {:drop, :missing_id}

  defp public(a), do: if(Activity.public?(a), do: :ok, else: {:drop, :not_public})

  defp fresh(%{"published" => p}, now, opts) when is_binary(p) do
    max_age = Keyword.get(opts, :max_age, 172_800)
    skew = Keyword.get(opts, :max_skew, 300)

    case DateTime.from_iso8601(p) do
      {:ok, t, _} ->
        d = DateTime.diff(now, t)
        if d > max_age or d < -skew, do: {:drop, :stale_or_future}, else: :ok

      _ ->
        {:drop, :invalid_published}
    end
  end

  defp fresh(_, _, _), do: :ok
end
