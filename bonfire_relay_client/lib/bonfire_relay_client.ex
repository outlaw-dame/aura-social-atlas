defmodule Bonfire.RelayClient do
  @moduledoc """
  Opt-in relay subscription client for Bonfire (Mastodon + LitePub, FEP-ae0c).

  Nothing happens automatically: `subscribe/3` must be called by an instance
  admin, and every entry point returns `{:error, :disabled}` /
  `:not_handled` while `enabled: false` (the default).

  `ctx` = `%{config: %Config{}, store: {StoreModule, server}, federation: FederationModule}`.
  """
  require Logger
  alias Bonfire.RelayClient.{Activity, Config, Filter, Policy, Protocol, Rules, Subscription, URL}

  @claim_lease_ms 300_000

  @doc "Admin action: subscribe to `relay_actor_id` using a fixed protocol."
  def subscribe(relay_actor_id, protocol, ctx) do
    %{config: cfg, store: {store, srv}, federation: fed} = ctx

    with :ok <- enabled(cfg),
         true <- protocol in Subscription.protocols() || {:error, :invalid_protocol},
         {:ok, relay_id, host} <- URL.parse_https(relay_actor_id),
         true <- host in cfg.allowed_relay_hosts || {:error, :relay_not_allowlisted},
         true <-
           live_count(store, srv) < cfg.max_subscriptions || {:error, :too_many_subscriptions},
         {:ok, %{id: ^relay_id, inbox: inbox}} <- fed.resolve_actor(relay_id),
         true <- URL.host(inbox) == host || {:error, :inbox_origin_mismatch},
         {:ok, local} <- fed.local_relay_actor(),
         # Persist-before-send: the Follow id is minted locally and the
         # :pending row is committed (atomically unique per relay) BEFORE the
         # Follow is queued, so an early Accept always finds its state and a
         # concurrent duplicate request loses at the insert and sends nothing.
         {:ok, follow_id} <- fed.mint_activity_id(local),
         true <- URL.host(follow_id) == URL.host(local) || {:error, :follow_id_origin_mismatch},
         {:ok, sub} <-
           store.insert_subscription(srv, %Subscription{
             relay_actor_id: relay_id,
             relay_inbox: inbox,
             relay_host: host,
             protocol: protocol,
             follow_id: follow_id,
             local_actor_id: local,
             kind: protocol,
             outbound_enabled: true,
             updated_at: DateTime.utc_now()
           }) do
      case fed.follow(local, relay_id, Protocol.follow_object(protocol, relay_id), follow_id) do
        {:ok, _} ->
          # Re-read: an Accept may already have advanced the state.
          {:ok, store.get_by_relay_actor(srv, relay_id) || sub}

        {:error, reason} ->
          mark_failed(store, srv, relay_id)
          {:error, {:follow_failed, reason}}
      end
    else
      {:ok, %{id: _}} -> {:error, :actor_id_mismatch}
      {:error, _} = e -> e
      other -> {:error, {:unexpected, other}}
    end
  end

  @doc "Admin action: unsubscribe (sends Undo Follow via Bonfire)."
  def unsubscribe(relay_actor_id, ctx) do
    %{store: {store, srv}, federation: fed} = ctx

    with %Subscription{} = sub <-
           store.get_by_relay_actor(srv, relay_actor_id) || {:error, :not_found},
         {:ok, sub} <- step_down(sub),
         {:ok, _} <- fed.unfollow(sub.local_actor_id, sub.relay_actor_id, sub.follow_id),
         {:ok, sub} <- finish_removal(sub) do
      store.update_subscription(srv, sub)
    end
  end

  defp mark_failed(store, srv, relay_id) do
    with %Subscription{} = s <- store.get_by_relay_actor(srv, relay_id),
         {:ok, s} <- Subscription.transition(s, :failed) do
      store.update_subscription(srv, s)
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
          # CAS on the state we read: a concurrent admin disable wins cleanly.
          {:ok, new} -> store.cas_subscription(srv, [sub.state], new)
          # Duplicate Accept for an already-accepted subscription is idempotent.
          {:error, {:invalid_transition, s, s}} -> {:ok, sub}
          err -> err
        end
    end
  end

  defp control_or_data("Follow", %{protocol: p}, _env, _ctx) when p != :litepub,
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
          store.cas_subscription(srv, [sub.state], %{sub | reciprocal_follow_id: a["id"]})
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
             do: store.cas_subscription(srv, [sub.state], s)

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
      with :ok <- throttle(sub, store, srv) do
        Policy.inbound(a, env,
          relay_host: sub.relay_host,
          max_age: cfg.max_activity_age_seconds,
          max_skew: cfg.max_clock_skew_seconds
        )
      end

    case decision do
      {:drop, reason} ->
        {:drop, reason}

      _ ->
        # Durable claim with status: :claimed (we own it, lease-bound),
        # :in_flight (another worker holds an unexpired lease), :done
        # (completed earlier). Only success or a PERMANENT rejection
        # completes the claim; transient failures release it for retry.
        case store.claim(srv, a["id"], @claim_lease_ms) do
          :done ->
            {:drop, :duplicate}

          :in_flight ->
            {:drop, :in_flight}

          :claimed ->
            case apply_decision(decision, sub, fed, compiled_rules(store, srv)) do
              {:ok, _} = ok ->
                store.complete(srv, a["id"])
                ok

              {:drop, _} = permanent ->
                store.complete(srv, a["id"])
                permanent

              {:error, _} = transient ->
                store.release(srv, a["id"])
                transient
            end
        end
    end
  end

  defp apply_decision({:ingest_verified, activity}, sub, fed, rules) do
    with {:keep, rule_ids} <- Filter.decide(Activity.object(activity), sub, rules) do
      fed.ingest(activity, ingest_opts(sub, rule_ids))
    end
  end

  defp apply_decision({:fetch, id}, sub, fed, rules) do
    with {:ok, obj} <- fed.fetch_object(id),
         {:ok, obj} <- Policy.verify_fetched(obj, id),
         {:keep, rule_ids} <- Filter.decide(obj, sub, rules) do
      fed.ingest(obj, ingest_opts(sub, rule_ids))
    end
  end

  # The relay is provenance only: never author, booster or followed account.
  defp ingest_opts(sub, rule_ids),
    do: [
      relayed_by: sub.relay_actor_id,
      trusted_relay: false,
      matched_rules: rule_ids,
      no_follow_graph: true
    ]

  defp compiled_rules(store, srv), do: Rules.compile(store.list_rules(srv))

  # Per-connection load control: a fixed one-minute window counter. Over the
  # limit the activity is dropped (relays do not redeliver, so this sheds
  # load instead of building a queue).
  defp throttle(sub, store, srv) do
    window = div(System.system_time(:second), 60)

    if store.bump_volume(srv, sub.relay_actor_id, window) > sub.max_per_minute,
      do: {:drop, :rate_limited},
      else: :ok
  end

  @doc """
  Outbound fan-out (opt-in via `outbound_enabled`).

  * Mastodon relays (state :accepted): the original signed public activity
    is delivered to the relay inbox.
  * LitePub relays (state :accepted AND reciprocal Follow accepted): the
    Bonfire service actor sends a public `Announce` of the object id to the
    relay inbox. Only `Create` is announced; other types are reported in
    `:skipped`, never silently dropped.

  Returns `{:ok, %{delivered: [...], skipped: [...], errors: [...]}}`.
  """
  def outbound(activity, local_host, ctx) do
    %{config: cfg, store: {store, srv}, federation: fed} = ctx

    cond do
      not (cfg.enabled and cfg.outbound_enabled) ->
        {:error, :disabled}

      not Policy.outbound?(activity, local_host) ->
        {:drop, :not_public_or_not_local}

      true ->
        active = Enum.filter(store.list(srv), &Subscription.active?/1)
        {buzz, active} = Enum.split_with(active, &(&1.protocol == :fedibuzz))
        {off, active} = Enum.split_with(active, &(not &1.outbound_enabled))
        {masto, lite} = Enum.split_with(active, &(&1.protocol == :mastodon))

        acc = %{
          delivered: [],
          skipped:
            Enum.map(buzz, &{&1.relay_inbox, :fedibuzz_is_inbound_only}) ++
              Enum.map(off, &{&1.relay_inbox, :outbound_disabled_for_connection}),
          errors: []
        }

        acc =
          case Enum.map(masto, & &1.relay_inbox) do
            [] -> acc
            inboxes -> record(acc, inboxes, fed.deliver(activity, inboxes))
          end

        acc = Enum.reduce(lite, acc, &litepub_out(&1, &2, activity, fed))
        {:ok, acc}
    end
  end

  defp litepub_out(%{reciprocal_follow_id: nil} = s, acc, _a, _fed),
    do: %{acc | skipped: [{s.relay_inbox, :reciprocal_follow_not_accepted} | acc.skipped]}

  defp litepub_out(s, acc, %{"type" => "Create"} = a, fed) do
    case Activity.id_of(Activity.object(a)) do
      id when is_binary(id) ->
        record(acc, [s.relay_inbox], fed.announce(s.local_actor_id, id, s.relay_inbox))

      _ ->
        %{acc | skipped: [{s.relay_inbox, :missing_object_id} | acc.skipped]}
    end
  end

  defp litepub_out(s, acc, _a, _fed),
    do: %{acc | skipped: [{s.relay_inbox, :litepub_announces_creates_only} | acc.skipped]}

  defp record(acc, inboxes, :ok), do: %{acc | delivered: acc.delivered ++ inboxes}
  defp record(acc, inboxes, {:ok, _}), do: %{acc | delivered: acc.delivered ++ inboxes}

  defp record(acc, inboxes, {:error, r}),
    do: %{acc | errors: acc.errors ++ Enum.map(inboxes, &{&1, r})}

  defp enabled(%Config{enabled: true}), do: :ok
  defp enabled(_), do: {:error, :disabled}

  defp live_count(store, srv),
    do: Enum.count(store.list(srv), &(&1.state in [:pending, :accepted, :unsubscribing]))
end
