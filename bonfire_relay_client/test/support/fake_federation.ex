defmodule Bonfire.RelayClient.Test.FakeFederation do
  @moduledoc "Offline stand-in for Bonfire's ActivityPub stack. Sends every call to the test process."
  @behaviour Bonfire.RelayClient.Federation

  @local "https://fedizen.example/pub/actors/relay"
  def local, do: @local

  defp notify(msg) do
    send(Application.get_env(:bonfire_relay_client, :test_pid), msg)
  end

  defp objects, do: Application.get_env(:bonfire_relay_client, :test_objects, %{})

  @impl true
  def local_relay_actor, do: {:ok, @local}

  @impl true
  def resolve_actor(id) do
    notify({:resolve, id})

    case Application.get_env(:bonfire_relay_client, :test_resolve) do
      f when is_function(f, 1) ->
        f.(id)

      _ ->
        host = URI.parse(id).host
        {:ok, %{id: id, inbox: "https://#{host}/inbox"}}
    end
  end

  # Failure injection: each op listed in :test_fail fails once (consumed).
  defp fail?(op) do
    fails = Application.get_env(:bonfire_relay_client, :test_fail, [])

    if op in fails do
      Application.put_env(:bonfire_relay_client, :test_fail, List.delete(fails, op))
      true
    else
      false
    end
  end

  @impl true
  def mint_activity_id(local),
    do: {:ok, "#{local}/follow/#{:erlang.unique_integer([:positive])}"}

  @impl true
  def follow(local, relay, object, follow_id) do
    notify({:follow, local, relay, object})

    # Simulates the relay answering before follow/4 returns (early Accept).
    case Application.get_env(:bonfire_relay_client, :test_on_follow) do
      f when is_function(f, 1) -> f.(follow_id)
      _ -> :ok
    end

    if fail?(:follow),
      do: {:error, :queue_down},
      else: {:ok, %{"id" => follow_id, "type" => "Follow"}}
  end

  @impl true
  def announce(local, object_id, inbox) do
    notify({:announce, local, object_id, inbox})
    if fail?(:announce), do: {:error, :queue_down}, else: :ok
  end

  @impl true
  def unfollow(local, relay, follow_id) do
    notify({:unfollow, local, relay, follow_id})
    {:ok, %{}}
  end

  @impl true
  def accept(local, follow) do
    notify({:accept, local, follow["id"]})
    {:ok, %{}}
  end

  @impl true
  def fetch_object(id) do
    notify({:fetch, id})

    cond do
      fail?(:fetch) -> {:error, :timeout}
      Map.has_key?(objects(), id) -> {:ok, Map.fetch!(objects(), id)}
      true -> {:error, :not_found}
    end
  end

  @impl true
  def ingest(data, opts) do
    notify({:ingest, data["id"], opts})
    if fail?(:ingest), do: {:error, :db_busy}, else: {:ok, data}
  end

  @impl true
  def deliver(activity, inboxes) do
    notify({:deliver, activity["id"], inboxes})
    :ok
  end
end
