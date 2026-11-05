defmodule Bonfire.RelayClient.Admin do
  @moduledoc """
  Server-side administration API (Mastodon "Admin → Relays" equivalent, plus
  hashtag and instance rules). EVERY function re-checks authorisation via
  `ctx.authorizer.admin?(ctx.actor)`; the UI is never trusted to have done
  it.

  `ctx` = the relay ctx (`config`, `store`, `federation`) plus `actor` (the
  current user/context) and `authorizer` (module implementing
  `Bonfire.RelayClient.Authorizer`).

  Wire identity: Follows are always sent by the instance SERVICE actor
  (`federation.local_relay_actor/0`). No user's following list, profile or
  boosts are touched; ingested content is marked `no_follow_graph: true`.
  """
  require Logger
  alias Bonfire.RelayClient.{FediBuzz, Protocol, Rules, Subscription, URL}

  @max_rate 100_000

  # --- authorisation ----------------------------------------------------------

  def authorize(%{authorizer: auth, actor: actor}) when not is_nil(actor) do
    if auth.admin?(actor) == true, do: :ok, else: {:error, :forbidden}
  end

  def authorize(_), do: {:error, :forbidden}

  defp audit(ctx, action, target) do
    Logger.info("relay_client admin action",
      relay_client_action: action,
      relay_client_target: target,
      relay_client_by: actor_label(ctx)
    )
  end

  defp actor_label(%{authorizer: auth, actor: a}) do
    if function_exported?(auth, :label, 1), do: auth.label(a), else: "admin"
  end

  # --- overview ---------------------------------------------------------------

  def overview(ctx) do
    %{store: {store, srv}, config: cfg} = ctx

    with :ok <- authorize(ctx) do
      conns = store.list(srv)
      rules = store.list_rules(srv)

      {:ok,
       %{
         feature_enabled: cfg.enabled,
         outbound_enabled: cfg.outbound_enabled,
         connections: conns,
         rules: rules,
         coverage: Rules.coverage(rules, conns)
       }}
    end
  end

  # --- connections (entity A) ---------------------------------------------------

  @doc """
  Add a connection in the `:idle` state. Nothing is sent yet.

  `input` is one of:
  * `%{kind: :mastodon | :litepub, url: actor_url}`
  * `%{kind: :fedibuzz_tag, tag: "knitting", host: "relay.fedi.buzz"}`
  * `%{kind: :fedibuzz_instance, domain: "fluffy.family", host: "relay.fedi.buzz"}`

  plus optional `inbound_policy`, `outbound_enabled`, `max_per_minute`.
  """
  def add_connection(ctx, input) do
    %{config: cfg, store: {store, srv}, federation: fed} = ctx
    input = Map.new(input)

    with :ok <- authorize(ctx),
         {:ok, kind} <- kind(Map.get(input, :kind)),
         {:ok, candidate, topic} <- candidate(kind, input),
         {:ok, _, host} <- URL.parse_https(candidate),
         true <- host in cfg.allowed_relay_hosts || {:error, :relay_not_allowlisted},
         true <-
           live_count(store, srv) < cfg.max_subscriptions || {:error, :too_many_subscriptions},
         {:ok, opts} <- connection_opts(kind, input),
         {:ok, resolved} <- resolve(fed, candidate),
         :ok <- verify_resolved(kind, candidate, resolved),
         {:ok, local} <- fed.local_relay_actor() do
      sub = %Subscription{
        relay_actor_id: resolved.id,
        relay_inbox: resolved.inbox,
        relay_host: host,
        protocol: Subscription.protocol_for_kind(kind),
        kind: kind,
        topic: topic,
        follow_id: nil,
        local_actor_id: local,
        state: :idle,
        inbound_policy: opts.inbound_policy,
        outbound_enabled: opts.outbound_enabled,
        max_per_minute: opts.max_per_minute,
        created_by: actor_label(ctx),
        updated_at: DateTime.utc_now()
      }

      with {:ok, sub} <- store.insert_subscription(srv, sub) do
        audit(ctx, :add_connection, sub.relay_actor_id)
        {:ok, sub}
      end
    end
  end

  defp kind(k) when is_atom(k) do
    if k in Subscription.kinds(), do: {:ok, k}, else: {:error, :invalid_kind}
  end

  defp kind(k) when is_binary(k) do
    case Enum.find(Subscription.kinds(), &(Atom.to_string(&1) == k)) do
      nil -> {:error, :invalid_kind}
      a -> {:ok, a}
    end
  end

  defp kind(_), do: {:error, :invalid_kind}

  defp candidate(k, %{url: url}) when k in [:mastodon, :litepub] do
    with {:ok, u, _} <- URL.parse_https(url), do: {:ok, u, nil}
  end

  defp candidate(:fedibuzz_tag, %{tag: tag} = i),
    do: FediBuzz.tag_url(tag, Map.get(i, :host, FediBuzz.default_host()))

  defp candidate(:fedibuzz_instance, %{domain: d} = i),
    do: FediBuzz.instance_url(d, Map.get(i, :host, FediBuzz.default_host()))

  defp candidate(_, _), do: {:error, :missing_input}

  defp connection_opts(kind, i) do
    policy = Map.get(i, :inbound_policy, :all_public)
    out = Map.get(i, :outbound_enabled, false)
    rate = Map.get(i, :max_per_minute, 600)

    cond do
      policy not in Subscription.inbound_policies() -> {:error, {:invalid, :inbound_policy}}
      not is_boolean(out) -> {:error, {:invalid, :outbound_enabled}}
      out and kind in [:fedibuzz_tag, :fedibuzz_instance] -> {:error, :fedibuzz_is_inbound_only}
      not (is_integer(rate) and rate >= 1 and rate <= @max_rate) -> {:error, {:invalid, :max_per_minute}}
      true -> {:ok, %{inbound_policy: policy, outbound_enabled: out, max_per_minute: rate}}
    end
  end

  defp resolve(fed, candidate) do
    case fed.resolve_actor(candidate) do
      {:ok, %{id: id, inbox: inbox} = r} when is_binary(id) and is_binary(inbox) ->
        with {:ok, id, _} <- URL.parse_https(id),
             {:ok, inbox, _} <- URL.parse_https(inbox) do
          {:ok, %{r | id: id, inbox: inbox}}
        end

      {:ok, _} ->
        {:error, :unresolvable_actor}

      {:error, _} ->
        # Mastodon's admin form takes an INBOX url; we need the actor, which
        # signs Accepts and relayed content, so we refuse rather than guess.
        {:error, :unresolvable_actor}
    end
  end

  defp verify_resolved(k, candidate, r) when k in [:fedibuzz_tag, :fedibuzz_instance],
    do: FediBuzz.verify_resolved(candidate, r)

  defp verify_resolved(_k, candidate, r) do
    cond do
      not URL.same_origin?(candidate, r.id) -> {:error, :actor_host_mismatch}
      not URL.same_origin?(candidate, r.inbox) -> {:error, :inbox_host_mismatch}
      true -> :ok
    end
  end

  @doc "Enable (or retry): idle/failed/rejected → pending, then queue the Follow."
  def enable(ctx, relay_id) do
    %{config: cfg, store: {store, srv}, federation: fed} = ctx

    with :ok <- authorize(ctx),
         true <- cfg.enabled || {:error, :feature_disabled},
         %Subscription{} = sub <- store.get_by_relay_actor(srv, relay_id) || {:error, :not_found},
         {:ok, follow_id} <- fed.mint_activity_id(sub.local_actor_id),
         true <-
           URL.host(follow_id) == URL.host(sub.local_actor_id) ||
             {:error, :follow_id_origin_mismatch},
         {:ok, pending} <- Subscription.transition(sub, :pending),
         pending = %{pending | follow_id: follow_id, reciprocal_follow_id: nil, last_error: nil},
         # persist-before-send; only one concurrent enable can win this CAS
         {:ok, _} <- store.cas_subscription(srv, [:idle, :failed, :rejected], pending) do
      audit(ctx, :enable, relay_id)
      object = Protocol.follow_object(sub.protocol, sub.relay_actor_id)

      case fed.follow(sub.local_actor_id, sub.relay_actor_id, object, follow_id) do
        {:ok, _} ->
          {:ok, store.get_by_relay_actor(srv, relay_id)}

        {:error, reason} ->
          failed = %{
            pending
            | state: :failed,
              last_error: error_label(reason),
              error_count: sub.error_count + 1
          }

          store.cas_subscription(srv, [:pending], failed)
          {:error, {:follow_failed, reason}}
      end
    end
  end

  def retry(ctx, relay_id), do: enable(ctx, relay_id)

  @doc "Disable: pending/accepted → idle, then queue Undo Follow. Inbound stops immediately."
  def disable(ctx, relay_id) do
    %{store: {store, srv}, federation: fed} = ctx

    with :ok <- authorize(ctx),
         %Subscription{} = sub <- store.get_by_relay_actor(srv, relay_id) || {:error, :not_found},
         {:ok, idle} <- Subscription.transition(sub, :idle),
         {:ok, _} <- store.cas_subscription(srv, [:pending, :accepted], idle) do
      audit(ctx, :disable, relay_id)

      case sub.follow_id && fed.unfollow(sub.local_actor_id, sub.relay_actor_id, sub.follow_id) do
        {:error, reason} ->
          store.update_subscription(srv, %{
            idle
            | last_error: "undo_failed: " <> error_label(reason),
              error_count: sub.error_count + 1
          })

        _ ->
          {:ok, idle}
      end
    end
  end

  @doc "Delete a connection. Must be disabled first and confirmed by repeating its id."
  def remove(ctx, relay_id, confirm: confirm) do
    %{store: {store, srv}} = ctx

    with :ok <- authorize(ctx),
         true <- confirm == relay_id || {:error, :confirmation_required},
         %Subscription{} = sub <- store.get_by_relay_actor(srv, relay_id) || {:error, :not_found},
         true <- sub.state in [:idle, :failed, :rejected, :removed] || {:error, :disable_first} do
      store.delete_subscription(srv, relay_id)
      audit(ctx, :remove, relay_id)
      :ok
    end
  end

  def remove(_ctx, _id, _), do: {:error, :confirmation_required}

  @doc "Update policy/load settings of a connection."
  def update_connection(ctx, relay_id, attrs) do
    %{store: {store, srv}} = ctx

    with :ok <- authorize(ctx),
         %Subscription{} = sub <- store.get_by_relay_actor(srv, relay_id) || {:error, :not_found},
         {:ok, opts} <-
           connection_opts(
             sub.kind || sub.protocol,
             Map.merge(
               %{
                 inbound_policy: sub.inbound_policy,
                 outbound_enabled: sub.outbound_enabled,
                 max_per_minute: sub.max_per_minute
               },
               Map.new(attrs)
             )
           ),
         {:ok, sub} <- store.cas_subscription(srv, [sub.state], Map.merge(sub, opts)) do
      audit(ctx, :update_connection, relay_id)
      {:ok, sub}
    end
  end

  # --- rules (entities B and C) -------------------------------------------------

  def add_tag_rule(ctx, attrs), do: put_new_rule(ctx, &Rules.tag_rule/1, attrs)
  def add_domain_rule(ctx, attrs), do: put_new_rule(ctx, &Rules.domain_rule/1, attrs)

  defp put_new_rule(ctx, builder, attrs) do
    %{store: {store, srv}} = ctx

    with :ok <- authorize(ctx),
         {:ok, rule} <-
           builder.(attrs |> Map.new() |> Map.drop([:id]) |> Map.put(:created_by, actor_label(ctx))),
         {:ok, rule} <- store.put_rule(srv, rule) do
      audit(ctx, :add_rule, rule.id)
      {:ok, rule}
    end
  end

  def set_rule_enabled(ctx, id, enabled) when is_boolean(enabled) do
    %{store: {store, srv}} = ctx

    with :ok <- authorize(ctx),
         %{} = rule <- Enum.find(store.list_rules(srv), &(&1.id == id)) || {:error, :not_found} do
      audit(ctx, :set_rule_enabled, id)
      store.put_rule(srv, %{rule | enabled: enabled})
    end
  end

  def delete_rule(ctx, id, confirm: confirm) do
    %{store: {store, srv}} = ctx

    with :ok <- authorize(ctx),
         true <- confirm == id || {:error, :confirmation_required} do
      store.delete_rule(srv, id)
      audit(ctx, :delete_rule, id)
      :ok
    end
  end

  def delete_rule(_, _, _), do: {:error, :confirmation_required}

  defp live_count(store, srv),
    do: Enum.count(store.list(srv), &(&1.state in [:idle | Subscription.live_states()]))

  defp error_label(r) when is_atom(r), do: Atom.to_string(r)
  defp error_label({tag, _}) when is_atom(tag), do: Atom.to_string(tag)
  defp error_label(_), do: "error"
end
