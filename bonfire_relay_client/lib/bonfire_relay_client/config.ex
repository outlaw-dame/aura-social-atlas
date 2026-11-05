defmodule Bonfire.RelayClient.Config do
  @moduledoc """
  Validated configuration. The feature is OFF unless `enabled: true` is set
  explicitly, and even then nothing is subscribed until an admin calls
  `Bonfire.RelayClient.subscribe/3`.

      config :bonfire_relay_client,
        enabled: false,
        allowed_relay_hosts: ["relay.example.org"],
        max_subscriptions: 10,
        max_activity_age_seconds: 172_800,
        outbound_enabled: false
  """

  alias Bonfire.RelayClient.URL

  @enforce_keys [:enabled]
  defstruct enabled: false,
            allowed_relay_hosts: [],
            max_subscriptions: 10,
            max_activity_age_seconds: 172_800,
            max_clock_skew_seconds: 300,
            outbound_enabled: false

  @type t :: %__MODULE__{}

  @spec load() :: {:ok, t()} | {:error, term()}
  def load, do: :bonfire_relay_client |> Application.get_all_env() |> validate()

  @spec validate(keyword() | map()) :: {:ok, t()} | {:error, term()}
  def validate(opts) do
    opts = Map.new(opts)

    with {:ok, enabled} <- bool(opts, :enabled, false),
         {:ok, outbound} <- bool(opts, :outbound_enabled, false),
         {:ok, hosts} <- hosts(Map.get(opts, :allowed_relay_hosts, [])),
         {:ok, max_subs} <- int(opts, :max_subscriptions, 10, 1, 100),
         {:ok, max_age} <- int(opts, :max_activity_age_seconds, 172_800, 60, 2_592_000),
         {:ok, skew} <- int(opts, :max_clock_skew_seconds, 300, 0, 3600) do
      {:ok,
       %__MODULE__{
         enabled: enabled,
         outbound_enabled: outbound,
         allowed_relay_hosts: hosts,
         max_subscriptions: max_subs,
         max_activity_age_seconds: max_age,
         max_clock_skew_seconds: skew
       }}
    end
  end

  defp bool(opts, key, default) do
    case Map.get(opts, key, default) do
      v when is_boolean(v) -> {:ok, v}
      _ -> {:error, {:invalid_config, key}}
    end
  end

  defp int(opts, key, default, min, max) do
    case Map.get(opts, key, default) do
      v when is_integer(v) and v >= min and v <= max -> {:ok, v}
      _ -> {:error, {:invalid_config, key}}
    end
  end

  defp hosts(list) when is_list(list) do
    Enum.reduce_while(list, {:ok, []}, fn h, {:ok, acc} ->
      case URL.normalize_host(h) do
        {:ok, host} -> {:cont, {:ok, [host | acc]}}
        _ -> {:halt, {:error, {:invalid_config, :allowed_relay_hosts}}}
      end
    end)
    |> case do
      {:ok, acc} -> {:ok, acc |> Enum.reverse() |> Enum.uniq()}
      err -> err
    end
  end

  defp hosts(_), do: {:error, {:invalid_config, :allowed_relay_hosts}}
end
