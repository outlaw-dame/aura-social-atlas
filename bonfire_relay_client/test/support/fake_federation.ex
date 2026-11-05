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
    host = URI.parse(id).host
    {:ok, %{id: id, inbox: "https://#{host}/inbox"}}
  end

  @impl true
  def follow(local, relay, object) do
    notify({:follow, local, relay, object})

    {:ok,
     %{"id" => "#{@local}/follow/#{:erlang.unique_integer([:positive])}", "type" => "Follow"}}
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
    if fail?(:fetch), do: throw(:never)

    case Map.fetch(objects(), id) do
      {:ok, o} -> {:ok, o}
      :error -> {:error, :not_found}
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
