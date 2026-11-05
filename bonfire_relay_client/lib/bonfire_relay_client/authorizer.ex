defmodule Bonfire.RelayClient.Authorizer do
  @moduledoc "Server-side admin check used by `Bonfire.RelayClient.Admin`."
  @callback admin?(actor :: term()) :: boolean()
  @callback label(actor :: term()) :: String.t()
  @optional_callbacks label: 1
end

defmodule Bonfire.RelayClient.Authorizer.Bonfire do
  @moduledoc """
  Bonfire implementation, mirroring the checks used by
  `Bonfire.UI.Me.InstanceSettingsLive` (`Bonfire.Me.Accounts.is_admin?/1`, or
  `Bonfire.Boundaries.can?(ctx, :configure, :instance)`). Fails closed when
  those modules are not loaded.
  """
  @behaviour Bonfire.RelayClient.Authorizer

  @impl true
  def admin?(ctx) do
    cond do
      Code.ensure_loaded?(Bonfire.Me.Accounts) and
        function_exported?(Bonfire.Me.Accounts, :is_admin?, 1) and
          apply(Bonfire.Me.Accounts, :is_admin?, [ctx]) == true ->
        true

      Code.ensure_loaded?(Bonfire.Boundaries) and
          function_exported?(Bonfire.Boundaries, :can?, 3) ->
        apply(Bonfire.Boundaries, :can?, [ctx, :configure, :instance]) == true

      true ->
        false
    end
  end

  @impl true
  def label(%{current_user: %{id: id}}), do: "user:" <> to_string(id)
  def label(%{id: id}), do: "user:" <> to_string(id)
  def label(_), do: "admin"
end
