defmodule Bonfire.RelayClient.Store do
  @moduledoc """
  Persistence boundary. `mark_seen/2` MUST be atomic across processes
  (insert-if-absent); the Ecto implementation relies on a UNIQUE index with
  `ON CONFLICT DO NOTHING`.
  """

  alias Bonfire.RelayClient.Subscription

  @type server :: term()

  @callback insert_subscription(server, Subscription.t()) ::
              {:ok, Subscription.t()} | {:error, :already_subscribed}
  @callback update_subscription(server, Subscription.t()) :: {:ok, Subscription.t()}
  @callback get_by_relay_actor(server, String.t()) :: Subscription.t() | nil
  @callback get_by_follow_id(server, String.t()) :: Subscription.t() | nil
  @callback list(server) :: [Subscription.t()]
  @callback mark_seen(server, String.t()) :: :new | :duplicate
end
