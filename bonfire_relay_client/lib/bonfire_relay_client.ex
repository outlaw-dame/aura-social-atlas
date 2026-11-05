defmodule Bonfire.RelayClient do
  @moduledoc """
  Opt-in relay subscription client for Bonfire (Mastodon + LitePub, FEP-ae0c).

  Nothing happens automatically: `subscribe/3` must be called by an instance
  admin, and every entry point returns `{:error, :disabled}` /
  `:not_handled` while `enabled: false` (the default).

  `ctx` = `%{config: %Config{}, store: {StoreModule, server}, federation: FederationModule}`.
  """
  require Logger
  alias Bonfire.RelayClient.{Activity, Config, Policy, Protocol, Subscription, URL}

  @doc "Admin action: subscribe to `relay_actor_id` using a fixed protocol."
  def subscribe(relay_actor_id, protocol, ctx) do
    %{config: cfg, store: {store, srv}, federation: fed} = ctx

    with :ok <- enabled(cfg),
         true <- protocol in Subscription.protocols() || {:error, :invalid_protocol},
         {:ok, relay_id, host} <- URL.parse_https(relay_actor_id),
         true <- host in cfg.allowed_relay_hosts || {:error, :relay_not_allowlisted},
         true <- live_count(store, srv) < cfg.max_subscriptions || {:error, :too_many_subscriptions},
         {:ok, %{id: ^relay_id, inbox: inbox}} <- fed.resolve_actor(relay_id),
         true <- URL.host(inbox) == host || {:error, :inbox_origin_mismatch},
         {:ok, local} <- fed.local_relay_actor(),
         {:ok, %{"id" => follow_id}} when is_binary(follow_id) <-
           fed.follow(local, relay_id, Protocol.follow_object(protocol, relay_id)) do
      store.insert_subscription(srv, %Subscription{
        relay_actor_id: relay_id,
        relay_inbox: inbox,
        relay_host: host,
        protocol: protocol,
        follow_id: follow_id,
        local_actor_id: local,
        updated_at: DateTime.utc_now()
      })
    else
      {:ok, %{id: _}} -> {:error, :actor_id_mismatch}
      {:error, _} = e -> e
      other -> {:error, {:unexpected, other}}
    end
  end

  @doc "Admin action: unsubscribe (sends Undo Follow via Bonfire)."
  def unsubscribe(relay_actor_id, ctx) do
    %{store: {store, srv}, federation: fed} = ctx

    with %Subscription{} = sub <- store.get_by_relay_actor(srv, relay_actor_id) || {:error, :not_found},
         {:ok, sub} <- step_down(sub),
         {:ok, _} <- fed.unfollow(sub.local_actor_id, sub.relay_actor_id, sub.follow_id),
         {:ok, sub} <- finish_removal(sub) do
      store.update_subscription(srv, sub)
    end
  end

  defp step_down(%{state: :pending} = s), do: {:ok, s}
  defp step_down(s), do: Subscription.transition(s, :unsubscribing)
  defp finish_removal(s), do: Subscription.transition(s, :removed)

  @doc """
  Entry point from Bonfire's VERIFIED inbox pipeline.

  `envelope` = `%{signer: actor_id_verified_by_http_signature, activity: map,
  ld_verified_actor: actor_id | nil}`. Returns `:not_handled` for anything
  not signed by a subscribed relay so Bonfire processes it normally.
  """
  def handle_incoming(%{signer: signer, activity: activity} = envelope, ctx)
      when is_binary(signer) and is_map(activity) do
    %{config: cfg, store: {store, srv}} = ctx

    with :ok <- enabled(cfg),
         %Subscription{} = sub <- store.get_by_relay_actor(srv, signer) do
      control_or_data(Activity.type(activity), sub, envelope, ctx)
    else
      _ -> :not_handled
    end
  end

  def handle_incoming(_, _), do: :not_handled

  # --- control plane ---------------------------------------------------------

  defp control_or_data(type, sub, %{activity: a}, ctx) when type in ["Accept", "Reject"] do
    %{store: {store, srv}} = ctx

    cond do
      Activity.actor_id(a) != sub.relay_actor_id ->
        {:error, :actor_mismatch}

      not Protocol.matches_follow?(sub, a, sub.local_actor_id) ->
        {:error, :unknown_follow}

      true ->
        to = if type == "Accept", do: :accepted, else: :rejected

        case Subscription.transition(sub, to) do
          {:ok, sub} -> store.update_subscription(srv, sub)
          # Duplicate Accept for an already-accepted subscription is idempotent.
          {:error, {:invalid_transition, s, s}} -> {:ok, sub}
          err -> err
        end
    end
  end

  defp control_or_data("Follow", %{protocol: :mastodon}, _env, _ctx),
    do: {:error, :protocol_mismatch}

  defp control_or_data("Follow", sub, %{activity: a}, ctx) do
    %{store: {store, srv}, federation: fed} = ctx

    cond do
      sub.state not in [:pending, :accepted] ->
        {:error, :subscription_inactive}

      not Protocol.reciprocal_follow?(sub, a, sub.local_actor_id) ->
        {:error, :invalid_reciprocal_follow}

      sub.reciprocal_follow_id == a["id"] ->
        {:ok, sub}

      true ->
        with {:ok, _} <- fed.accept(sub.local_actor_id, a) do
          store.update_subscription(srv, %{sub | reciprocal_follow_id: a["id"]})
        end
    end
  end

  defp control_or_data("Undo", sub, %{activity: a}, ctx) do
    %{store: {store, srv}} = ctx
    inner = Activity.object(a)

    cond do
      Activity.actor_id(a) != sub.relay_actor_id ->
        {:error, :actor_mismatch}

      Activity.id_of(inner) == sub.reciprocal_follow_id and is_binary(sub.reciprocal_follow_id) ->
        # Relay stopped following us: treat as relay ending the subscription.
        with {:ok, s} <- Subscription.transition(sub, :rejected),
             do: store.update_subscription(srv, s)

      true ->
        {:error, :unknown_undo}
    end
  end

  # --- data plane ------------------------------------------------------------

  defp control_or_data(_type, %{state: state}, _env, _ctx) when state != :accepted,
    do: {:drop, :subscription_inactive}

  defp control_or_data(_type, sub, %{activity: a} = env, ctx) do
    %{config: cfg, store: {store, srv}, federation: fed} = ctx

    decision =
      Policy.inbound(a, env,
        relay_host: sub.relay_host,
        max_age: cfg.max_activity_age_seconds,
        max_skew: cfg.max_clock_skew_seconds
      )

    case decision do
      {:drop, reason} ->
        {:drop, reason}

      _ ->
        if store.mark_seen(srv, a["id"]) == :duplicate do
          {:drop, :duplicate}
        else
          apply_decision(decision, sub, fed)
        end
    end
  end

  defp apply_decision({:ingest_verified, activity}, sub, fed),
    do: fed.ingest(activity, relayed_by: sub.relay_actor_id, trusted_relay: false)

  defp apply_decision({:fetch, id}, sub, fed) do
    with {:ok, obj} <- fed.fetch_object(id),
         {:ok, obj} <- Policy.verify_fetched(obj, id) do
      fed.ingest(obj, relayed_by: sub.relay_actor_id, trusted_relay: false)
    end
  end

  @doc "Outbound fan-out to ACCEPTED Mastodon-protocol relays (opt-in via `outbound_enabled`)."
  def outbound(activity, local_host, ctx) do
    %{config: cfg, store: {store, srv}, federation: fed} = ctx

    inboxes =
      for s <- store.list(srv), Subscription.active?(s), s.protocol == :mastodon, do: s.relay_inbox

    cond do
      not (cfg.enabled and cfg.outbound_enabled) -> {:error, :disabled}
      not Policy.outbound?(activity, local_host) -> {:drop, :not_public_or_not_local}
      inboxes == [] -> {:ok, []}
      true -> with :ok <- fed.deliver(activity, inboxes), do: {:ok, inboxes}
    end
  end

  defp enabled(%Config{enabled: true}), do: :ok
  defp enabled(_), do: {:error, :disabled}

  defp live_count(store, srv),
    do: Enum.count(store.list(srv), &(&1.state in [:pending, :accepted, :unsubscribing]))
end
