defmodule Bonfire.RelayClient.MixProject do
  use Mix.Project

  # Standalone build has NO dependencies on purpose: the protocol, URL, policy
  # and state-machine core is pure Elixir so it can be compiled and tested
  # offline. Modules that touch Bonfire (`Bonfire.RelayClient.Federation.Bonfire`)
  # or Ecto (`Bonfire.RelayClient.Store.Ecto`) are wrapped in
  # `Code.ensure_loaded?/1` guards and only compile inside a Bonfire host app,
  # which already ships `ecto_sql`, `activity_pub` and
  # `bonfire_federate_activitypub`.
  def project do
    [
      app: :bonfire_relay_client,
      version: "0.1.0",
      elixir: "~> 1.15",
      elixirc_paths: elixirc_paths(Mix.env()),
      start_permanent: false,
      deps: [],
      description: "Opt-in Mastodon/LitePub relay subscription client for Bonfire"
    ]
  end

  def application, do: [extra_applications: [:logger]]

  defp elixirc_paths(:test), do: ["lib", "test/support"]
  defp elixirc_paths(_), do: ["lib"]
end
