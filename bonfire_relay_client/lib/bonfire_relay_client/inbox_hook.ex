defmodule Bonfire.RelayClient.InboxHook do
  @moduledoc """
  Target of the upstream inbox hook:

      config :activity_pub, relay_inbox_hook: Bonfire.RelayClient.InboxHook

  The patched `ReceiverHelpers` calls this only for deliveries whose HTTP
  signature verified, after body proof/LD checks, with
  `%{signer:, activity:, ld_verified_actor:}`.

  `:not_handled` (anything not signed by a subscribed relay, or the feature
  is off or misconfigured) makes Bonfire process the delivery exactly as it
  does today.
  """
  require Logger
  alias Bonfire.RelayClient
  alias Bonfire.RelayClient.Context

  def handle_incoming(%{signer: signer, activity: activity} = envelope)
      when is_binary(signer) and is_map(activity) do
    case Context.build(nil) do
      {:ok, ctx} ->
        RelayClient.handle_incoming(
          Map.take(envelope, [:signer, :activity, :ld_verified_actor]),
          ctx
        )

      {:error, reason} ->
        Logger.debug("relay_client inbox hook inactive: #{inspect(reason)}")
        :not_handled
    end
  end

  def handle_incoming(_), do: :not_handled
end
