defmodule Bonfire.RelayClient.Activity do
  @moduledoc "Small, total helpers for reading AS2 JSON maps."

  @public "https://www.w3.org/ns/activitystreams#Public"
  @public_aliases [@public, "as:Public", "Public"]

  def public_uri, do: @public

  @doc "Returns the id of a value that may be a string or an object with `id`."
  def id_of(v) when is_binary(v), do: v
  def id_of(%{"id" => id}) when is_binary(id), do: id
  def id_of(_), do: nil

  def recipients(%{} = m) do
    for key <- ["to", "cc"], v <- List.wrap(Map.get(m, key)), id = id_of(v), is_binary(id), do: id
  end

  def recipients(_), do: []

  @doc "Addressed to as:Public (to or cc)."
  def public?(%{} = m), do: Enum.any?(recipients(m), &(&1 in @public_aliases))
  def public?(_), do: false

  def type(%{"type" => t}) when is_binary(t), do: t
  def type(%{"type" => [t | _]}) when is_binary(t), do: t
  def type(_), do: nil

  def actor_id(%{"actor" => a}), do: id_of(a)
  def actor_id(_), do: nil

  def object(%{"object" => o}), do: o
  def object(_), do: nil
end
