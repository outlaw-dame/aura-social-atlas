defmodule Bonfire.RelayClient.Store do
  @moduledoc """
  Persistence boundary. `insert_subscription/2` and `claim/3` MUST be atomic
  across processes. Claims carry a status: `claim/3` returns `:claimed` when
  the caller now owns the activity (new, or a previous owner's lease
  expired), `:in_flight` while another owner's lease is live, and `:done`
  once `complete/2` has been called. `release/2` gives a claim back after a
  transient failure so a redelivery can retry it.
  """

  alias Bonfire.RelayClient.Subscription

  @type server :: term()

  @callback insert_subscription(server, Subscription.t()) ::
              {:ok, Subscription.t()} | {:error, :already_subscribed}
  @callback update_subscription(server, Subscription.t()) :: {:ok, Subscription.t()}
  @callback get_by_relay_actor(server, String.t()) :: Subscription.t() | nil
  @callback get_by_follow_id(server, String.t()) :: Subscription.t() | nil
  @callback list(server) :: [Subscription.t()]
  @callback claim(server, String.t(), lease_ms :: pos_integer()) :: :claimed | :in_flight | :done
  @callback complete(server, String.t()) :: :ok
  @callback release(server, String.t()) :: :ok
end
