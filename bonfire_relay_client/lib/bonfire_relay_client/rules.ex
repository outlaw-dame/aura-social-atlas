defmodule Bonfire.RelayClient.Rules do
  @moduledoc """
  Managed discovery rules: hashtag rules (entity B) and instance/domain
  rules (entity C). These are LOCAL post-ingestion filters on content a
  connected relay actually delivered. They never fetch anything by
  themselves, and a rule with no connection able to deliver matching
  content is reported as `:no_source` (see `coverage/2`), never as active
  discovery.
  """
  alias Bonfire.RelayClient.{Hashtag, Subscription, URL}

  defmodule TagRule do
    @moduledoc "Keep posts carrying ANY (`:any`) or ALL (`:all`) of `tags`."
    @enforce_keys [:id, :tags]
    defstruct [:id, :tags, mode: :any, scope: :all, enabled: true, created_by: nil, note: nil]
  end

  defmodule DomainRule do
    @moduledoc """
    Keep posts authored on `domain`.

    * `mode: :observed` keeps posts from that domain that ANY in-scope relay
      happened to deliver (no completeness promise).
    * `mode: :whole_instance` asks for that instance's full public stream. It
      only has a source when an accepted `fedibuzz_instance` connection for
      the same domain exists; otherwise coverage reports `:no_source`.

    `tags` (optional) further requires hashtags, with `tag_mode`.
    """
    @enforce_keys [:id, :domain]
    defstruct [
      :id,
      :domain,
      mode: :observed,
      scope: :all,
      tags: [],
      tag_mode: :any,
      enabled: true,
      created_by: nil,
      note: nil
    ]
  end

  @modes [:any, :all]
  @domain_modes [:observed, :whole_instance]
  @max_tags_per_rule 20

  @doc "Build a validated TagRule from admin input."
  def tag_rule(attrs) do
    a = Map.new(attrs)

    with {:ok, tags} <- Hashtag.normalize_all(Map.get(a, :tags)),
         true <- length(tags) <= @max_tags_per_rule || {:error, :too_many_tags},
         {:ok, mode} <- enum(a, :mode, :any, @modes),
         {:ok, scope} <- scope(Map.get(a, :scope, :all)) do
      {:ok,
       %TagRule{
         id: Map.get(a, :id) || new_id(),
         tags: tags,
         mode: mode,
         scope: scope,
         enabled: Map.get(a, :enabled, true) == true,
         created_by: Map.get(a, :created_by),
         note: note(Map.get(a, :note))
       }}
    end
  end

  @doc "Build a validated DomainRule from admin input."
  def domain_rule(attrs) do
    a = Map.new(attrs)

    with {:ok, domain} <- URL.normalize_host(Map.get(a, :domain)),
         {:ok, mode} <- enum(a, :mode, :observed, @domain_modes),
         {:ok, tag_mode} <- enum(a, :tag_mode, :any, @modes),
         {:ok, tags} <- optional_tags(Map.get(a, :tags, [])),
         {:ok, scope} <- scope(Map.get(a, :scope, :all)) do
      {:ok,
       %DomainRule{
         id: Map.get(a, :id) || new_id(),
         domain: domain,
         mode: mode,
         tags: tags,
         tag_mode: tag_mode,
         scope: scope,
         enabled: Map.get(a, :enabled, true) == true,
         created_by: Map.get(a, :created_by),
         note: note(Map.get(a, :note))
       }}
    end
  end

  defp optional_tags([]), do: {:ok, []}
  defp optional_tags(nil), do: {:ok, []}
  defp optional_tags(t), do: Hashtag.normalize_all(t)

  defp enum(a, k, default, allowed) do
    v = Map.get(a, k, default)
    if v in allowed, do: {:ok, v}, else: {:error, {:invalid, k}}
  end

  defp scope(:all), do: {:ok, :all}

  defp scope({:connections, ids}) when is_list(ids) and ids != [] do
    if Enum.all?(ids, &match?({:ok, _, _}, URL.parse_https(&1))),
      do: {:ok, {:connections, Enum.uniq(ids)}},
      else: {:error, {:invalid, :scope}}
  end

  defp scope(_), do: {:error, {:invalid, :scope}}

  defp note(n) when is_binary(n), do: n |> String.trim() |> String.slice(0, 280)
  defp note(_), do: nil

  defp new_id, do: Base.url_encode64(:crypto.strong_rand_bytes(12), padding: false)

  @doc """
  Pre-indexed rule set for fast matching: tag → rules and domain → rules,
  so evaluating a post costs O(tags on the post + 1), not O(rules).
  """
  def compile(rules) do
    enabled = Enum.filter(rules, & &1.enabled)

    by_tag =
      for %TagRule{} = r <- enabled, t <- r.tags, reduce: %{} do
        acc -> Map.update(acc, t, [r], &[r | &1])
      end

    by_domain =
      for %DomainRule{} = r <- enabled, reduce: %{} do
        acc -> Map.update(acc, r.domain, [r], &[r | &1])
      end

    %{by_tag: by_tag, by_domain: by_domain, empty?: enabled == []}
  end

  @doc "Rules (from a compiled set) that keep `object` delivered via `relay_id`."
  def matching(compiled, object, author_host, relay_id) do
    tags = Hashtag.from_object(object)

    tag_hits =
      tags
      |> Enum.flat_map(&Map.get(compiled.by_tag, &1, []))
      |> Enum.uniq()
      |> Enum.filter(&(in_scope?(&1, relay_id) and tags_ok?(&1.tags, &1.mode, tags)))

    domain_hits =
      compiled.by_domain
      |> Map.get(author_host, [])
      |> Enum.filter(&(in_scope?(&1, relay_id) and (&1.tags == [] or tags_ok?(&1.tags, &1.tag_mode, tags))))

    tag_hits ++ domain_hits
  end

  defp in_scope?(%{scope: :all}, _), do: true
  defp in_scope?(%{scope: {:connections, ids}}, relay_id), do: relay_id in ids

  defp tags_ok?(wanted, :any, have), do: Enum.any?(wanted, &MapSet.member?(have, &1))
  defp tags_ok?(wanted, :all, have), do: Enum.all?(wanted, &MapSet.member?(have, &1))

  @doc """
  Honest coverage report per rule: `:active` with the connections that can
  deliver for it, or `:no_source` with a reason. Never claims completeness.
  """
  def coverage(rules, connections) do
    accepted = Enum.filter(connections, &Subscription.active?/1)

    Map.new(rules, fn r -> {r.id, cover(r, accepted)} end)
  end

  defp cover(%{enabled: false}, _), do: {:disabled, []}

  defp cover(%DomainRule{mode: :whole_instance} = r, accepted) do
    case Enum.filter(accepted, &(&1.kind == :fedibuzz_instance and &1.topic == r.domain)) do
      [] -> {:no_source, :needs_accepted_fedibuzz_instance_connection}
      srcs -> {:active, Enum.map(srcs, & &1.relay_actor_id)}
    end
  end

  defp cover(r, accepted) do
    srcs =
      accepted
      |> Enum.filter(&in_scope?(r, &1.relay_actor_id))
      |> Enum.map(& &1.relay_actor_id)

    if srcs == [], do: {:no_source, :no_accepted_connection_in_scope}, else: {:active, srcs}
  end
end
