defmodule Bonfire.RelayClient.Hashtag do
  @moduledoc """
  Hashtag normalisation and matching.

  * `normalize/1`: trims, strips one leading `#`, applies Unicode NFKC, then
    a full Unicode lowercase (Elixir's `String.downcase/1`, which folds e.g.
    `Straße` → `straße` and `ΣΑΣ` → `σας`). Only letters, marks, numbers and `_`
    are allowed, as in Mastodon. All-digit tags are refused because they are
    not hashtags in Mastodon either.
  * `relay_key/1`: the key FediBuzz/buzzrelay itself uses for `/tag/...`
    actors (`deunicode` → lowercase → drop whitespace and `-`). We approximate
    `deunicode` with NFKD + dropping combining marks, which is exact for Latin
    diacritics but NOT for every script. That is why a FediBuzz URL is
    always resolved, never assumed (see `Bonfire.RelayClient.FediBuzz`).
  * `from_object/1`: reads ONLY `tag` entries of `type: "Hashtag"` on the
    ActivityPub object. Content is never scanned, so `#knitting` inside a
    link, code block or another word does not match.
  """

  @max_len 100

  @spec normalize(term()) :: {:ok, String.t()} | {:error, :invalid_hashtag}
  def normalize(tag) when is_binary(tag) do
    t =
      tag
      |> String.trim()
      |> String.replace_prefix("#", "")
      |> :unicode.characters_to_nfkc_binary()
      |> case do
        b when is_binary(b) -> String.downcase(b)
        _ -> ""
      end

    cond do
      t == "" or String.length(t) > @max_len -> {:error, :invalid_hashtag}
      not Regex.match?(~r/^[\p{L}\p{M}\p{N}_]+$/u, t) -> {:error, :invalid_hashtag}
      Regex.match?(~r/^[\p{N}_]+$/u, t) -> {:error, :invalid_hashtag}
      true -> {:ok, t}
    end
  end

  def normalize(_), do: {:error, :invalid_hashtag}

  @doc "Normalise a list, de-duplicated, failing on the first invalid tag."
  def normalize_all(tags) when is_list(tags) and tags != [] do
    Enum.reduce_while(tags, {:ok, []}, fn t, {:ok, acc} ->
      case normalize(t) do
        {:ok, n} -> {:cont, {:ok, [n | acc]}}
        {:error, _} -> {:halt, {:error, {:invalid_hashtag, t}}}
      end
    end)
    |> case do
      {:ok, acc} -> {:ok, acc |> Enum.reverse() |> Enum.uniq()}
      e -> e
    end
  end

  def normalize_all(_), do: {:error, :no_hashtags}

  @doc "buzzrelay's own tag key, used only to build a candidate URL."
  def relay_key(normalized) do
    normalized
    |> :unicode.characters_to_nfd_binary()
    |> String.replace(~r/\p{M}/u, "")
    |> String.downcase()
    |> String.replace(~r/[\s-]/u, "")
  end

  @doc "Normalised hashtags declared on an AS2 object (Hashtag tags only)."
  @spec from_object(map()) :: MapSet.t(String.t())
  def from_object(%{"tag" => tags}) do
    tags
    |> List.wrap()
    |> Enum.flat_map(fn
      %{"type" => "Hashtag", "name" => name} when is_binary(name) ->
        case normalize(name) do
          {:ok, n} -> [n]
          _ -> []
        end

      _ ->
        []
    end)
    |> MapSet.new()
  end

  def from_object(_), do: MapSet.new()
end
