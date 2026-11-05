defmodule Bonfire.RelayClient.Subscription do
  @moduledoc """
  A relay connection (entity A) and its state machine.

  ```text
          enable                Accept
   idle ---------> pending -------------> accepted
    ^  ^             | |  \\                 |  \\
    |  |   disable   | |   +-- Reject --+    |   +-- Reject --> rejected
    |  +-------------+ |                v    |                   |
    |                  +-- queue fail -> failed                  |
    +------------- disable (Undo sent) --------------------------+
           (failed / rejected --retry/enable--> pending, fresh Follow id)

   legacy admin API: accepted --unsubscribe--> unsubscribing --> removed
  ```

  `protocol` (wire behaviour) and `kind` (what the admin added) are fixed at
  creation. A reply shaped like another protocol is refused, never
  "downgraded".

  Kinds:
  * `:mastodon` — FEP-ae0c Mastodon relay, Follow `object` = as:Public.
  * `:litepub`  — LitePub relay, Follow the relay actor, reciprocal Follow.
  * `:fedibuzz_tag` / `:fedibuzz_instance` — FediBuzz/buzzrelay topic
    actors: Follow the resolved topic actor; it only ever sends
    `Announce{object: id}`; it never receives our posts.
  """

  @states [:idle, :pending, :accepted, :rejected, :unsubscribing, :removed, :failed]
  @protocols [:mastodon, :litepub, :fedibuzz]
  @kinds [:mastodon, :litepub, :fedibuzz_tag, :fedibuzz_instance]
  @inbound_policies [:all_public, :rules_only]

  @enforce_keys [:relay_actor_id, :relay_inbox, :relay_host, :protocol, :follow_id]
  defstruct [
    :relay_actor_id,
    :relay_inbox,
    :relay_host,
    :protocol,
    :follow_id,
    :local_actor_id,
    kind: nil,
    topic: nil,
    state: :pending,
    reciprocal_follow_id: nil,
    inbound_policy: :all_public,
    outbound_enabled: false,
    max_per_minute: 600,
    created_by: nil,
    last_error: nil,
    error_count: 0,
    updated_at: nil
  ]

  @type state :: :idle | :pending | :accepted | :rejected | :unsubscribing | :removed | :failed
  @type t :: %__MODULE__{}

  def states, do: @states
  def protocols, do: @protocols
  def kinds, do: @kinds
  def inbound_policies, do: @inbound_policies

  def protocol_for_kind(:mastodon), do: :mastodon
  def protocol_for_kind(:litepub), do: :litepub
  def protocol_for_kind(k) when k in [:fedibuzz_tag, :fedibuzz_instance], do: :fedibuzz

  @transitions %{
    idle: [:pending],
    pending: [:accepted, :rejected, :removed, :failed, :idle],
    accepted: [:unsubscribing, :rejected, :idle],
    unsubscribing: [:removed],
    rejected: [:pending, :idle],
    removed: [],
    failed: [:pending, :idle]
  }

  @doc "States in which a connection holds a live (or in-progress) Follow."
  def live_states, do: [:pending, :accepted, :unsubscribing]

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
