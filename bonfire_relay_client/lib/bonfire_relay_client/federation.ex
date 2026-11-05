defmodule Bonfire.RelayClient.Federation do
  @moduledoc """
  The ONLY boundary between this extension and Bonfire's ActivityPub stack.
  Every outgoing activity is built, signed and queued by Bonfire
  (`ActivityPub.follow/2`, `ActivityPub.unfollow/2`, `ActivityPub.accept/2`,
  publisher worker); every fetch goes through Bonfire's signed fetcher with
  its SSRF and origin checks. This extension never POSTs raw JSON itself.
  """

  @type actor_id :: String.t()

  @doc "The local instance actor used to subscribe (e.g. Bonfire's service/relay actor)."
  @callback local_relay_actor() :: {:ok, actor_id} | {:error, term()}

  @doc "Resolve a remote actor via Bonfire (WebFinger/actor fetch). Returns its inbox."
  @callback resolve_actor(actor_id) :: {:ok, %{id: actor_id, inbox: String.t()}} | {:error, term()}

  @doc "Build, sign and queue a Follow. `object` is as:Public (Mastodon) or the relay actor (LitePub)."
  @callback follow(local :: actor_id, relay :: actor_id, object :: String.t()) ::
              {:ok, %{required(String.t()) => term()}} | {:error, term()}

  @callback unfollow(local :: actor_id, relay :: actor_id, follow_id :: String.t()) ::
              {:ok, term()} | {:error, term()}

  @doc "Accept a verified incoming Follow (LitePub reciprocal follow)."
  @callback accept(local :: actor_id, follow :: map()) :: {:ok, term()} | {:error, term()}

  @doc "Fetch an object from ITS ORIGIN through Bonfire's signed fetcher."
  @callback fetch_object(String.t()) :: {:ok, map()} | {:error, term()}

  @doc "Hand a verified public object/activity to Bonfire's normal incoming pipeline."
  @callback ingest(map(), opts :: keyword()) :: {:ok, term()} | {:error, term()}

  @doc "Queue a local activity for signed delivery to the given inboxes."
  @callback deliver(activity :: map(), inboxes :: [String.t()]) :: :ok | {:error, term()}
end
