defmodule Bonfire.RelayClient.Subscription do
  @moduledoc """
  A relay subscription and its state machine.

  ```text
  pending --Accept--> accepted --unsubscribe--> unsubscribing --> removed
     |                   |
     +--Reject--> rejected          (rejected/removed are terminal; a fresh
     +--unsubscribe--> removed       subscribe creates a new Follow id)
     +--Follow queue failed--> failed
  ```

  `protocol` is fixed at creation and never changes: an Accept/Follow that
  looks like the other protocol is refused rather than "downgraded".
  """

  @states [:pending, :accepted, :rejected, :unsubscribing, :removed, :failed]
  @protocols [:mastodon, :litepub]

  @enforce_keys [:relay_actor_id, :relay_inbox, :relay_host, :protocol, :follow_id]
  defstruct [
    :relay_actor_id,
    :relay_inbox,
    :relay_host,
    :protocol,
    :follow_id,
    :local_actor_id,
    state: :pending,
    reciprocal_follow_id: nil,
    updated_at: nil
  ]

  @type state :: :pending | :accepted | :rejected | :unsubscribing | :removed | :failed
  @type t :: %__MODULE__{}

  def states, do: @states
  def protocols, do: @protocols

  @transitions %{
    pending: [:accepted, :rejected, :removed, :failed],
    accepted: [:unsubscribing, :rejected],
    unsubscribing: [:removed],
    rejected: [],
    removed: [],
    failed: []
  }

  @spec transition(t(), state()) :: {:ok, t()} | {:error, {:invalid_transition, state(), state()}}
  def transition(%__MODULE__{state: from} = sub, to) do
    if to in Map.fetch!(@transitions, from) do
      {:ok, %{sub | state: to, updated_at: DateTime.utc_now()}}
    else
      {:error, {:invalid_transition, from, to}}
    end
  end

  def active?(%__MODULE__{state: :accepted}), do: true
  def active?(_), do: false
end
