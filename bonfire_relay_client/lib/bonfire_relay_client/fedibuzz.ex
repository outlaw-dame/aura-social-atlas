defmodule Bonfire.RelayClient.FediBuzz do
  @moduledoc """
  FediBuzz / buzzrelay topic relays (https://relay.fedi.buzz,
  https://github.com/astro/buzzrelay).

  buzzrelay serves one ActivityPub actor per topic at `/tag/{tag}` and
  `/instance/{host}`. The same path accepts POSTed Follows (as its inbox), it
  Accepts with the topic actor, and then sends `Announce{object: post uri}`
  addressed to as:Public for matching posts it saw on Mastodon streaming APIs.

  This module only builds a CANDIDATE URL from validated, typed input. The
  connection is created only after the URL is resolved (through Bonfire's
  fetcher) to an actor document on the same host and path, and the Follow is
  addressed to that resolved actor. We never assume `/tag/...` is an actor
  id without resolving it.

  A FediBuzz subscription is a SERVER-level Follow by the instance's service
  actor. It is not a hashtag follow by a user, and it is not a Mastodon
  public-collection relay subscription.
  """
  alias Bonfire.RelayClient.{Hashtag, URL}

  @default_host "relay.fedi.buzz"
  def default_host, do: @default_host

  @spec tag_url(String.t(), String.t()) :: {:ok, String.t(), String.t()} | {:error, term()}
  def tag_url(tag, host \\ @default_host) do
    with {:ok, h} <- URL.normalize_host(host),
         {:ok, norm} <- Hashtag.normalize(tag),
         key when key != "" <- Hashtag.relay_key(norm) || {:error, :invalid_hashtag} do
      {:ok, "https://#{h}/tag/#{URI.encode(key, &URI.char_unreserved?/1)}", norm}
    else
      "" -> {:error, :invalid_hashtag}
      e -> e
    end
  end

  @spec instance_url(String.t(), String.t()) :: {:ok, String.t(), String.t()} | {:error, term()}
  def instance_url(domain, host \\ @default_host) do
    with {:ok, h} <- URL.normalize_host(host),
         {:ok, d} <- URL.normalize_host(domain),
         true <- d != h || {:error, :self_reference} do
      {:ok, "https://#{h}/instance/#{d}", d}
    end
  end

  @doc """
  Check a resolved actor against the candidate: it must be on the same host,
  and its id must be the candidate URL, or a URL under the same topic path.
  """
  def verify_resolved(candidate, %{id: id, inbox: inbox}) do
    c = URI.parse(candidate)
    i = URI.parse(id)

    cond do
      not URL.same_origin?(candidate, id) ->
        {:error, :actor_host_mismatch}

      not URL.same_origin?(candidate, inbox) ->
        {:error, :inbox_host_mismatch}

      String.trim_trailing(i.path || "", "/") != String.trim_trailing(c.path || "", "/") ->
        {:error, :actor_path_mismatch}

      true ->
        :ok
    end
  end

  def verify_resolved(_, _), do: {:error, :unresolvable}
end
