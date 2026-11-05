defmodule Bonfire.RelayClient.MixProject do
  use Mix.Project

  # The protocol/policy/filter/admin core is pure Elixir. Modules touching
  # Ecto, Phoenix LiveView or Bonfire are wrapped in `Code.ensure_loaded?/1`
  # guards. In a Bonfire host those libraries come from the host app; here
  # they are dev/test-only deps so the Ecto store and the admin LiveView are
  # compiled and the Ecto store is tested against a real PostgreSQL
  # (set RELAY_CLIENT_PG_URL; those tests are skipped otherwise).
  def project do
    [
      app: :bonfire_relay_client,
      version: "0.2.0",
      elixir: "~> 1.15",
      elixirc_paths: elixirc_paths(Mix.env()),
      start_permanent: false,
      deps: deps(),
      description: "Opt-in Mastodon/LitePub/FediBuzz relay subscriptions for Bonfire instances"
    ]
  end

  def application, do: [extra_applications: [:logger]]

  defp deps do
    [
      {:ecto_sql, "~> 3.12", only: [:dev, :test]},
      {:postgrex, "~> 0.19", only: [:dev, :test]},
      {:phoenix_live_view, "~> 1.0", only: [:dev, :test]},
      {:jason, "~> 1.4", only: [:dev, :test]}
    ]
  end

  defp elixirc_paths(:test), do: ["lib", "test/support"]
  defp elixirc_paths(_), do: ["lib"]
end
