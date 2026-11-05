defmodule Bonfire.RelayClient.Store.Memory do
  @moduledoc """
  In-process store for tests and local experiments only. Atomic within one
  node because every operation is a single Agent call; NOT a production
  store (no persistence, no cross-node atomicity).
  """
  @behaviour Bonfire.RelayClient.Store
  use Agent
  alias Bonfire.RelayClient.Subscription

  def start_link(opts \\ []) do
    Agent.start_link(
      fn -> %{subs: %{}, seen: %{}, rules: %{}, volume: %{}} end,
      Keyword.take(opts, [:name])
    )
  end

  @impl true
  def insert_subscription(s, sub) do
    Agent.get_and_update(s, fn st ->
      case st.subs[sub.relay_actor_id] do
        %{state: state} when state in [:pending, :accepted, :unsubscribing, :idle] ->
          {{:error, :already_subscribed}, st}

        _ ->
          {{:ok, sub}, put_in(st, [:subs, sub.relay_actor_id], sub)}
      end
    end)
  end

  @impl true
  def update_subscription(s, sub) do
    Agent.update(s, &put_in(&1, [:subs, sub.relay_actor_id], sub))
    {:ok, sub}
  end

  @impl true
  def cas_subscription(s, expected, %Subscription{} = sub) do
    Agent.get_and_update(s, fn st ->
      case st.subs[sub.relay_actor_id] do
        %{state: cur} ->
          if cur in expected,
            do: {{:ok, sub}, put_in(st, [:subs, sub.relay_actor_id], sub)},
            else: {{:error, :conflict}, st}

        nil ->
          {{:error, :conflict}, st}
      end
    end)
  end

  @impl true
  def delete_subscription(s, id), do: Agent.update(s, &%{&1 | subs: Map.delete(&1.subs, id)})

  @impl true
  def get_by_relay_actor(s, id), do: Agent.get(s, & &1.subs[id])

  @impl true
  def get_by_follow_id(s, id),
    do:
      Agent.get(s, fn st ->
        Enum.find_value(st.subs, fn {_, v} -> v.follow_id == id && v end)
      end)

  @impl true
  def list(s), do: Agent.get(s, &Map.values(&1.subs))

  @impl true
  def put_rule(s, rule) do
    Agent.update(s, &put_in(&1, [:rules, rule.id], rule))
    {:ok, rule}
  end

  @impl true
  def delete_rule(s, id), do: Agent.update(s, &%{&1 | rules: Map.delete(&1.rules, id)})

  @impl true
  def list_rules(s), do: Agent.get(s, &Map.values(&1.rules))

  @impl true
  def claim(s, id, lease_ms) do
    now = System.monotonic_time(:millisecond)

    Agent.get_and_update(s, fn st ->
      case st.seen[id] do
        :done -> {:done, st}
        {:claimed, until} when until > now -> {:in_flight, st}
        _ -> {:claimed, put_in(st, [:seen, id], {:claimed, now + lease_ms})}
      end
    end)
  end

  @impl true
  def complete(s, id), do: Agent.update(s, &put_in(&1, [:seen, id], :done))

  @impl true
  def release(s, id) do
    Agent.update(s, fn st ->
      case st.seen[id] do
        {:claimed, _} -> %{st | seen: Map.delete(st.seen, id)}
        _ -> st
      end
    end)
  end

  @impl true
  def bump_volume(s, relay_id, window) do
    Agent.get_and_update(s, fn st ->
      n = Map.get(st.volume, {relay_id, window}, 0) + 1
      {n, put_in(st, [:volume, {relay_id, window}], n)}
    end)
  end
end
