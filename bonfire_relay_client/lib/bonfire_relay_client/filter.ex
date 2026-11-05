defmodule Bonfire.RelayClient.Filter do
  @moduledoc """
  Local post-ingestion filter, applied AFTER the policy and origin checks to
  an object a relay delivered. Two layers:

  1. Topic integrity for selective FediBuzz sources. A `fedibuzz_tag`
     connection must deliver posts that carry its tag as a real AS2 Hashtag.
     A `fedibuzz_instance` connection must deliver posts authored on its
     instance. Anything else is off-topic and dropped.
  2. Connection inbound policy. `:all_public` keeps everything that passed
     policy. `:rules_only` keeps only posts matching an enabled, in-scope
     tag or domain rule, and keeps nothing at all when there are no rules
     (fail closed).
  """
  alias Bonfire.RelayClient.{Hashtag, Rules, Subscription, URL}

  @spec decide(map(), Subscription.t(), map()) :: {:keep, [term()]} | {:drop, atom()}
  def decide(object, %Subscription{} = sub, compiled) do
    author_host = author_host(object)

    with :ok <- on_topic(sub, object, author_host) do
      case sub.inbound_policy do
        :all_public ->
          {:keep, []}

        :rules_only ->
          if compiled.empty? do
            {:drop, :no_rules}
          else
            case Rules.matching(compiled, object, author_host, sub.relay_actor_id) do
              [] -> {:drop, :no_rule_matched}
              hits -> {:keep, Enum.map(hits, & &1.id)}
            end
          end
      end
    end
  end

  defp on_topic(%{kind: :fedibuzz_instance, topic: d}, _o, host) when is_binary(d) do
    if host == d, do: :ok, else: {:drop, :off_topic}
  end

  defp on_topic(%{kind: :fedibuzz_tag, topic: t}, o, _host) when is_binary(t) do
    key = Hashtag.relay_key(t)

    if Enum.any?(Hashtag.from_object(o), &(&1 == t or Hashtag.relay_key(&1) == key)),
      do: :ok,
      else: {:drop, :off_topic}
  end

  defp on_topic(_, _, _), do: :ok

  defp author_host(o) do
    case o["attributedTo"] |> List.wrap() |> List.first() do
      %{"id" => id} -> URL.host(id)
      id when is_binary(id) -> URL.host(id)
      _ -> URL.host(o["id"])
    end
  end
end
