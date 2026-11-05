defmodule Bonfire.RelayClient.Store.Memory do
  @moduledoc """
  In-process store for tests and local experiments only. Atomic within one
  node because every operation runs inside a single Agent call; NOT a
  production store (no persistence, no cross-node atomicity).
  """
  @behaviour Bonfire.RelayClient.Store
  use Agent

  def start_link(opts \\ []) do
    Agent.start_link(fn -> %{subs: %{}, seen: MapSet.new()} end, Keyword.take(opts, [:name]))
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
  def mark_seen(s, id) do
    Agent.get_and_update(s, fn st ->
      if MapSet.member?(st.seen, id),
        do: {:duplicate, st},
        else: {:new, %{st | seen: MapSet.put(st.seen, id)}}
    end)
  end
end
