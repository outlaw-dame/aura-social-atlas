defmodule Bonfire.RelayClient.Store.Memory do
  @moduledoc """
  In-process store for tests and local experiments only. Atomic within one
  node because every operation runs inside a single Agent call; NOT a
  production store (no persistence, no cross-node atomicity).
  """
  @behaviour Bonfire.RelayClient.Store
  use Agent

  def start_link(opts \\ []) do
    Agent.start_link(fn -> %{subs: %{}, seen: %{}} end, Keyword.take(opts, [:name]))
  end

  @impl true
  def insert_subscription(s, sub) do
    Agent.get_and_update(s, fn st ->
      live? =
        case st.subs[sub.relay_actor_id] do
          %{state: state} when state in [:pending, :accepted, :unsubscribing] -> true
          _ -> false
        end

      if live?,
        do: {{:error, :already_subscribed}, st},
        else: {{:ok, sub}, put_in(st, [:subs, sub.relay_actor_id], sub)}
    end)
  end

  @impl true
  def update_subscription(s, sub) do
    Agent.update(s, &put_in(&1, [:subs, sub.relay_actor_id], sub))
    {:ok, sub}
  end

  @impl true
  def get_by_relay_actor(s, id), do: Agent.get(s, & &1.subs[id])

  @impl true
  def get_by_follow_id(s, id),
    do:
      Agent.get(s, fn st -> Enum.find_value(st.subs, fn {_, v} -> v.follow_id == id && v end) end)

  @impl true
  def list(s), do: Agent.get(s, &Map.values(&1.subs))

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
end
