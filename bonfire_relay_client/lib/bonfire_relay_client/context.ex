defmodule Bonfire.RelayClient.Context do
  @moduledoc """
  Builds the runtime ctx from application config:

      config :bonfire_relay_client,
        store: {Bonfire.RelayClient.Store.Ecto, Bonfire.Common.Repo},
        federation: Bonfire.RelayClient.Federation.Bonfire,
        authorizer: Bonfire.RelayClient.Authorizer.Bonfire

  If anything is missing or the config is invalid, `build/1` returns an
  error. Callers (including the admin UI) then show the feature as
  unavailable instead of falling back to a default.
  """
  alias Bonfire.RelayClient.Config

  def build(actor) do
    env = Application.get_all_env(:bonfire_relay_client)

    with {:ok, cfg} <- Config.validate(Keyword.drop(env, [:store, :federation, :authorizer, :local_actor_username])),
         {mod, _srv} = store when is_atom(mod) <- Keyword.get(env, :store) || {:error, :store_not_configured},
         fed when is_atom(fed) and not is_nil(fed) <-
           Keyword.get(env, :federation) || {:error, :federation_not_configured},
         auth when is_atom(auth) and not is_nil(auth) <-
           Keyword.get(env, :authorizer) || {:error, :authorizer_not_configured} do
      {:ok, %{config: cfg, store: store, federation: fed, authorizer: auth, actor: actor}}
    else
      {:error, _} = e -> e
      _ -> {:error, :invalid_context_config}
    end
  end
end
