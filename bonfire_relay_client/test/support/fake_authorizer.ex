defmodule Bonfire.RelayClient.Test.FakeAuthorizer do
  @moduledoc false
  @behaviour Bonfire.RelayClient.Authorizer
  @impl true
  def admin?(%{admin: true}), do: true
  def admin?(_), do: false
  @impl true
  def label(%{name: n}), do: n
  def label(_), do: "anon"
end
