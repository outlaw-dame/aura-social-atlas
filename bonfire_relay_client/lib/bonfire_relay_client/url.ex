defmodule Bonfire.RelayClient.URL do
  @moduledoc """
  Strict URL/host helpers. Only `https` URLs on public DNS names are accepted
  as relay identities; IP literals, localhost, userinfo, fragments and
  non-default ports are refused. Network-level SSRF protection (DNS
  rebinding, redirects) remains the job of Bonfire's own HTTP client, which
  every fetch is delegated to.
  """

  @blocked_suffixes [".localhost", ".local", ".internal", ".lan", ".home.arpa", ".onion"]

  @spec normalize_host(term()) :: {:ok, String.t()} | {:error, :invalid_host}
  def normalize_host(host) when is_binary(host) do
    h = host |> String.trim() |> String.downcase() |> String.trim_trailing(".")

    cond do
      h == "" or byte_size(h) > 253 ->
        {:error, :invalid_host}

      h == "localhost" ->
        {:error, :invalid_host}

      Enum.any?(@blocked_suffixes, &String.ends_with?(h, &1)) ->
        {:error, :invalid_host}

      ip_literal?(h) ->
        {:error, :invalid_host}

      not String.contains?(h, ".") ->
        {:error, :invalid_host}

      not Regex.match?(~r/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/, h) ->
        {:error, :invalid_host}

      true ->
        {:ok, h}
    end
  end

  def normalize_host(_), do: {:error, :invalid_host}

  @doc "Validates and canonicalises an https URL; returns {:ok, url, host}."
  @spec parse_https(term()) :: {:ok, String.t(), String.t()} | {:error, atom()}
  def parse_https(url) when is_binary(url) and byte_size(url) <= 2048 do
    case URI.new(url) do
      {:ok, %URI{scheme: "https", userinfo: nil, fragment: nil, host: host, port: port} = uri}
      when port in [nil, 443] ->
        with {:ok, h} <- normalize_host(host || "") do
          {:ok, URI.to_string(%URI{uri | host: h, port: nil, path: uri.path || "/"}), h}
        end

      {:ok, _} ->
        {:error, :invalid_url}

      _ ->
        {:error, :invalid_url}
    end
  end

  def parse_https(_), do: {:error, :invalid_url}

  @spec host(term()) :: String.t() | nil
  def host(url) when is_binary(url) do
    case parse_https(url) do
      {:ok, _, h} -> h
      _ -> nil
    end
  end

  def host(_), do: nil

  @doc "True when both URLs are valid https URLs on exactly the same host."
  def same_origin?(a, b) do
    ha = host(a)
    ha != nil and ha == host(b)
  end

  defp ip_literal?(h) do
    String.starts_with?(h, "[") or match?({:ok, _}, :inet.parse_address(String.to_charlist(h)))
  end
end
