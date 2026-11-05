defmodule Bonfire.RelayClient.Store do
  @moduledoc """
  Persistence boundary for the three entities: connections (subscriptions),
  rules (tag + domain) and the inbound claim/volume ledger.

  Atomicity contract (every implementation must honour it across processes):

  * `insert_subscription/2` admits at most one live row per relay actor.
  * `cas_subscription/3` updates a row only if its CURRENT state is one of
    `expected`, so concurrent enable/disable/Accept can't both win.
  * `claim/3` is an insert-or-take-over-expired-lease. It returns `:claimed`,
    `:in_flight` while another owner's lease is live, or `:done` once
    `complete/2` was called. `release/2` gives it back after a transient error.
  * `bump_volume/3` atomically increments and returns the per-window count.
  """

  alias Bonfire.RelayClient.Subscription

  @type server :: term()

  @callback insert_subscription(server, Subscription.t()) ::
              {:ok, Subscription.t()} | {:error, :already_subscribed}
  @callback update_subscription(server, Subscription.t()) :: {:ok, Subscription.t()}
  @callback cas_subscription(server, [Subscription.state()], Subscription.t()) ::
              {:ok, Subscription.t()} | {:error, :conflict}
  @callback delete_subscription(server, String.t()) :: :ok
  @callback get_by_relay_actor(server, String.t()) :: Subscription.t() | nil
  @callback get_by_follow_id(server, String.t()) :: Subscription.t() | nil
  @callback list(server) :: [Subscription.t()]

  @callback put_rule(server, struct()) :: {:ok, struct()}
  @callback delete_rule(server, String.t()) :: :ok
  @callback list_rules(server) :: [struct()]

  @callback claim(server, String.t(), lease_ms :: pos_integer()) :: :claimed | :in_flight | :done
  @callback complete(server, String.t()) :: :ok
  @callback release(server, String.t()) :: :ok
  @callback bump_volume(server, String.t(), window :: integer()) :: non_neg_integer()
end
