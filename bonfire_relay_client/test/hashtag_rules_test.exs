defmodule Bonfire.RelayClient.HashtagRulesTest do
  use ExUnit.Case, async: true
  alias Bonfire.RelayClient.{FediBuzz, Filter, Hashtag, Rules, Subscription}

  @public "https://www.w3.org/ns/activitystreams#Public"

  describe "Hashtag.normalize/1" do
    test "strips #, NFKC, Unicode lowercase" do
      assert {:ok, "knitting"} = Hashtag.normalize("#Knitting")
      assert {:ok, "knit"} = Hashtag.normalize("ｋｎｉｔ")
      assert {:ok, "straße"} = Hashtag.normalize("STRASSE" |> String.replace("SS", "ß"))
      assert {:ok, "café"} = Hashtag.normalize("Cafe\u0301")
      assert {:ok, "日本語"} = Hashtag.normalize("#日本語")
      assert {:ok, "a_1"} = Hashtag.normalize("A_1")
    end

    test "rejects non-tags" do
      for bad <- ["", "#", "123", "__", "a b", "a-b", "a.b", "#a#b", String.duplicate("a", 101), nil, 5] do
        assert {:error, _} = Hashtag.normalize(bad), inspect(bad)
      end
    end

    test "normalize_all de-duplicates and reports the bad input" do
      assert {:ok, ["knitting"]} = Hashtag.normalize_all(["#Knitting", "knitting"])
      assert {:error, {:invalid_hashtag, "no way"}} = Hashtag.normalize_all(["ok", "no way"])
      assert {:error, :no_hashtags} = Hashtag.normalize_all([])
    end

    test "relay_key matches buzzrelay's deunicode/lowercase for Latin" do
      {:ok, n} = Hashtag.normalize("Café")
      assert Hashtag.relay_key(n) == "cafe"
    end

    test "from_object reads only AS2 Hashtag tags, never content" do
      obj = %{
        "content" => "#notatag in text",
        "tag" => [
          %{"type" => "Hashtag", "name" => "#Knitting"},
          %{"type" => "Mention", "name" => "@knitting"},
          %{"type" => "Hashtag", "name" => "bad tag"},
          "junk"
        ]
      }

      assert Hashtag.from_object(obj) == MapSet.new(["knitting"])
      assert Hashtag.from_object(%{"tag" => %{"type" => "Hashtag", "name" => "#solo"}}) == MapSet.new(["solo"])
    end
  end

  defp obj(author, tags) do
    %{
      "id" => author <> "/n/1",
      "attributedTo" => author,
      "to" => [@public],
      "tag" => Enum.map(tags, &%{"type" => "Hashtag", "name" => "#" <> &1})
    }
  end

  describe "rules" do
    test "validation" do
      assert {:error, {:invalid, :mode}} = Rules.tag_rule(%{tags: ["a"], mode: :xor})
      assert {:error, :too_many_tags} = Rules.tag_rule(%{tags: Enum.map(1..21, &"t#{&1}x")})
      assert {:error, :invalid_host} = Rules.domain_rule(%{domain: "127.0.0.1"})
      assert {:error, {:invalid, :scope}} = Rules.tag_rule(%{tags: ["a"], scope: {:connections, ["http://x.org"]}})
      assert {:ok, %{domain: "fluffy.family"}} = Rules.domain_rule(%{domain: "Fluffy.Family."})
    end

    test "any / all semantics on real Hashtag tags" do
      {:ok, any} = Rules.tag_rule(%{tags: ["knitting", "crochet"], mode: :any})
      {:ok, all} = Rules.tag_rule(%{tags: ["knitting", "crochet"], mode: :all})
      c = Rules.compile([any, all])
      one = obj("https://a.example/u/x", ["knitting"])
      both = obj("https://a.example/u/x", ["Knitting", "CROCHET"])
      ids = fn o -> Rules.matching(c, o, "a.example", "https://r.example/actor") |> Enum.map(& &1.id) end
      assert ids.(one) == [any.id]
      assert Enum.sort(ids.(both)) == Enum.sort([any.id, all.id])
      assert ids.(obj("https://a.example/u/x", ["knittingx"])) == []
    end

    test "domain rule with optional tag condition and per-relay scope" do
      {:ok, d} = Rules.domain_rule(%{domain: "a.example", tags: ["art"], scope: {:connections, ["https://r.example/actor"]}})
      c = Rules.compile([d])
      assert [_] = Rules.matching(c, obj("https://a.example/u", ["art"]), "a.example", "https://r.example/actor")
      assert [] = Rules.matching(c, obj("https://a.example/u", ["art"]), "a.example", "https://other.example/actor")
      assert [] = Rules.matching(c, obj("https://a.example/u", ["cats"]), "a.example", "https://r.example/actor")
      assert [] = Rules.matching(c, obj("https://b.example/u", ["art"]), "b.example", "https://r.example/actor")
    end

    test "disabled rules never match" do
      {:ok, r} = Rules.tag_rule(%{tags: ["x1"], enabled: false})
      c = Rules.compile([r])
      assert c.empty?
    end

    test "coverage is honest: no source until an accepted connection can deliver" do
      {:ok, t} = Rules.tag_rule(%{tags: ["art"]})
      {:ok, w} = Rules.domain_rule(%{domain: "fluffy.family", mode: :whole_instance})
      base = %Subscription{relay_actor_id: "https://relay.fedi.buzz/instance/fluffy.family", relay_inbox: "i", relay_host: "relay.fedi.buzz", protocol: :fedibuzz, follow_id: "f", kind: :fedibuzz_instance, topic: "fluffy.family"}

      cov = Rules.coverage([t, w], [%{base | state: :pending}])
      assert {:no_source, _} = cov[t.id]
      assert {:no_source, :needs_accepted_fedibuzz_instance_connection} = cov[w.id]

      cov = Rules.coverage([t, w], [%{base | state: :accepted}])
      assert {:active, [_]} = cov[w.id]
      assert {:active, [_]} = cov[t.id]

      other = %{base | state: :accepted, topic: "other.example"}
      assert {:no_source, _} = Rules.coverage([w], [other])[w.id]
    end
  end

  describe "FediBuzz URLs" do
    test "canonical candidate URLs from typed input" do
      assert {:ok, "https://relay.fedi.buzz/tag/knitting", "knitting"} = FediBuzz.tag_url("#Knitting")
      assert {:ok, "https://relay.fedi.buzz/tag/cafe", "café"} = FediBuzz.tag_url("Café")
      assert {:ok, "https://relay.fedi.buzz/tag/%E6%97%A5%E6%9C%AC", _} = FediBuzz.tag_url("日本")
      assert {:ok, "https://relay.fedi.buzz/instance/fluffy.family", "fluffy.family"} = FediBuzz.instance_url("Fluffy.Family")
      assert {:error, _} = FediBuzz.tag_url("../admin")
      assert {:error, _} = FediBuzz.instance_url("10.0.0.1")
      assert {:error, :self_reference} = FediBuzz.instance_url("relay.fedi.buzz")
      assert {:error, _} = FediBuzz.tag_url("x1", "localhost")
    end

    test "resolved actor must match host and topic path" do
      c = "https://relay.fedi.buzz/tag/knitting"
      assert :ok = FediBuzz.verify_resolved(c, %{id: c, inbox: c})
      assert {:error, :actor_host_mismatch} = FediBuzz.verify_resolved(c, %{id: "https://evil.example/tag/knitting", inbox: c})
      assert {:error, :inbox_host_mismatch} = FediBuzz.verify_resolved(c, %{id: c, inbox: "https://evil.example/i"})
      assert {:error, :actor_path_mismatch} = FediBuzz.verify_resolved(c, %{id: "https://relay.fedi.buzz/tag/other", inbox: c})
      assert {:error, :unresolvable} = FediBuzz.verify_resolved(c, nil)
    end
  end

  describe "Filter" do
    defp sub(attrs),
      do: struct(%Subscription{relay_actor_id: "https://r.example/actor", relay_inbox: "i", relay_host: "r.example", protocol: :mastodon, follow_id: "f"}, attrs)

    test "rules_only with no rules fails closed" do
      assert {:drop, :no_rules} = Filter.decide(obj("https://a.example/u", ["x1"]), sub(inbound_policy: :rules_only), Rules.compile([]))
    end

    test "all_public keeps; rules_only keeps only matches" do
      {:ok, r} = Rules.tag_rule(%{tags: ["art"]})
      c = Rules.compile([r])
      assert {:keep, []} = Filter.decide(obj("https://a.example/u", ["x1"]), sub(%{}), c)
      assert {:keep, [_]} = Filter.decide(obj("https://a.example/u", ["art"]), sub(inbound_policy: :rules_only), c)
      assert {:drop, :no_rule_matched} = Filter.decide(obj("https://a.example/u", ["x1"]), sub(inbound_policy: :rules_only), c)
    end

    test "FediBuzz topic integrity" do
      c = Rules.compile([])
      tag = sub(protocol: :fedibuzz, kind: :fedibuzz_tag, topic: "café")
      assert {:keep, _} = Filter.decide(obj("https://a.example/u", ["Cafe"]), tag, c)
      assert {:drop, :off_topic} = Filter.decide(obj("https://a.example/u", ["tea"]), tag, c)
      inst = sub(protocol: :fedibuzz, kind: :fedibuzz_instance, topic: "fluffy.family")
      assert {:keep, _} = Filter.decide(obj("https://fluffy.family/u", []), inst, c)
      assert {:drop, :off_topic} = Filter.decide(obj("https://other.example/u", []), inst, c)
    end
  end
end
