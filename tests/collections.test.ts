import { afterEach, describe, expect, test } from "bun:test";
import {
  COLLECTIONS_MAX,
  ITEMS_MAX,
  collectionFromMastodon,
  collectionInput,
  featureDecision,
  mastodonCollectionApi,
  normalizeTag,
  parseFediHandle,
} from "../src/lib/collections";
import { checkFeatureable, net, readMastodonCollection } from "../src/lib/collections.server";

const account = (id: string, acct: string, extra: Record<string, unknown> = {}) => ({
  id,
  acct,
  username: acct.split("@")[0],
  display_name: acct.split("@")[0].toUpperCase(),
  url: `https://social.example.net/@${acct.split("@")[0]}`,
  uri: `https://social.example.net/users/${acct.split("@")[0]}`,
  avatar: `https://cdn.example.net/${id}.png`,
  ...extra,
});

function fakeNet(routes: Record<string, unknown>) {
  const seen: string[] = [];
  net.fetch = async (url: string) => {
    seen.push(url);
    return url in routes
      ? new Response(JSON.stringify(routes[url]), { headers: { "content-type": "application/json" } })
      : new Response("{}", { status: 404 });
  };
  net.lookup = async () => ["93.184.216.34"];
  return seen;
}
afterEach(() => {
  net.fetch = undefined;
  net.lookup = undefined;
});

describe("limits match Mastodon 4.6", () => {
  test("25 accounts, 10 collections", () => {
    expect(ITEMS_MAX).toBe(25);
    expect(COLLECTIONS_MAX).toBe(10);
  });
  test("name ≤ 40, description ≤ 100, one valid hashtag", () => {
    expect(collectionInput.safeParse({ name: "x".repeat(40) }).success).toBe(true);
    expect(collectionInput.safeParse({ name: "x".repeat(41) }).success).toBe(false);
    expect(collectionInput.safeParse({ name: "" }).success).toBe(false);
    expect(collectionInput.safeParse({ name: "ok", description: "d".repeat(101) }).success).toBe(false);
    expect(collectionInput.parse({ name: "ok", tag: "#Fediverse" }).tag).toBe("Fediverse");
    expect(collectionInput.safeParse({ name: "ok", tag: "two words" }).success).toBe(false);
    expect(collectionInput.parse({ name: "  Cozy  " }).name).toBe("Cozy");
  });
  test("hashtags: letters/digits/_, not only digits", () => {
    expect(normalizeTag("#café_2026")).toBe("café_2026");
    expect(normalizeTag("2026")).toBeNull();
    expect(normalizeTag("a-b")).toBeNull();
  });
});

describe("consent (feature_approval)", () => {
  test.each([
    [{ automatic: ["public"], manual: [], current_user: "automatic" }, "automatic"],
    [{ automatic: ["followers"], manual: ["public"] }, "manual"],
    [{ automatic: ["followers", "following"], manual: [] }, "denied"],
    [{ automatic: [], manual: [] }, "denied"],
    [{ automatic: ["something_new"] }, "denied"],
    [null, "denied"],
  ])("%j → %s", (approval, expected) => {
    expect(featureDecision(approval as never)).toBe(expected as never);
  });

  test("an account that opted in can be added", async () => {
    fakeNet({
      "https://social.example.net/api/v1/accounts/lookup?acct=jane": account("1", "jane", { feature_approval: { automatic: ["public"], manual: [] } }),
    });
    const r = await checkFeatureable("@jane@social.example.net");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.account).toMatchObject({ acct: "@jane@social.example.net", name: "JANE", actorUri: "https://social.example.net/users/jane" });
  });

  test("no feature_approval (older Mastodon, other software) means no", async () => {
    fakeNet({ "https://social.example.net/api/v1/accounts/lookup?acct=old": account("2", "old") });
    expect(await checkFeatureable("old@social.example.net")).toMatchObject({ ok: false, reason: "missing" });
  });

  test("opted out means no", async () => {
    fakeNet({
      "https://social.example.net/api/v1/accounts/lookup?acct=shy": account("3", "shy", { feature_approval: { automatic: [], manual: [] } }),
    });
    expect(await checkFeatureable("@shy@social.example.net")).toMatchObject({ ok: false, reason: "denied" });
  });

  test("a server can't vouch for someone else's account", async () => {
    const approval = { feature_approval: { automatic: ["public"], manual: [] } };
    fakeNet({
      // A server we were pointed at returns another server's identity with an "opt-in".
      "https://evil.example.org/api/v1/accounts/lookup?acct=victim": account("9", "victim", approval),
      // Or a cached remote account.
      "https://evil.example.org/api/v1/accounts/lookup?acct=cached": account("8", "cached@social.example.net", { ...approval, url: "https://evil.example.org/@cached@social.example.net", uri: "https://evil.example.org/users/x" }),
    });
    expect(await checkFeatureable("@victim@evil.example.org")).toMatchObject({ ok: false, reason: "not-found" });
    expect(await checkFeatureable("@cached@evil.example.org")).toMatchObject({ ok: false, reason: "not-found" });
  });

  test("Bluesky handles and unknown accounts are refused without a network call to them", async () => {
    const seen = fakeNet({});
    expect(await checkFeatureable("@ann.bsky.social")).toMatchObject({ ok: false });
    expect(await checkFeatureable("@ghost@social.example.net")).toMatchObject({ ok: false, reason: "not-found" });
    expect(seen).toEqual(["https://social.example.net/api/v1/accounts/lookup?acct=ghost"]);
  });
});

describe("Mastodon collections", () => {
  const payload = {
    collection: {
      id: "116131056935959117",
      account_id: "10",
      uri: "https://social.example.net/ap/10/collections/116131056935959117",
      url: "https://social.example.net/collections/116131056935959117",
      name: "Excellent people",
      description: "<p>Well worth following</p>",
      language: "en",
      local: true,
      sensitive: false,
      discoverable: true,
      tag: { name: "discovery", url: "https://social.example.net/tags/discovery" },
      item_count: 2,
      items: [
        { id: "a", account_id: "11", state: "accepted", created_at: "2026-02-25T11:35:01.394Z" },
        { id: "b", account_id: "12", state: "pending", created_at: "2026-02-25T11:35:01.394Z" },
      ],
      created_at: "2026-02-25T11:35:01.394Z",
      updated_at: "2026-02-25T11:37:38.182Z",
    },
    accounts: [account("10", "curator"), account("11", "ann@other.example.org"), account("12", "pending")],
  };

  test("maps the documented CollectionWithAccounts, showing only accepted members", () => {
    const c = collectionFromMastodon(payload, "social.example.net")!;
    expect(c).toMatchObject({ source: "mastodon", name: "Excellent people", description: "Well worth following", tag: "discovery", language: "en", itemCount: 2 });
    expect(c.curator.acct).toBe("@curator@social.example.net");
    expect(c.items.map((i) => i.acct)).toEqual(["@ann@other.example.org"]);
  });

  test("a shared collection link opens through the server's API", async () => {
    expect(mastodonCollectionApi("https://social.example.net/collections/116131056935959117")).toEqual({
      host: "social.example.net",
      api: "https://social.example.net/api/v1/collections/116131056935959117",
    });
    expect(mastodonCollectionApi("http://social.example.net/collections/1")).toBeNull();
    expect(mastodonCollectionApi("https://social.example.net/@x")).toBeNull();
    fakeNet({ "https://social.example.net/api/v1/collections/116131056935959117": payload });
    expect((await readMastodonCollection("https://social.example.net/collections/116131056935959117"))?.name).toBe("Excellent people");
  });

  test("handles: @user@host, user@host and profile URLs", () => {
    expect(parseFediHandle("@Jane@Social.Example.net")).toEqual({ user: "Jane", host: "social.example.net" });
    expect(parseFediHandle("https://social.example.net/@jane")).toEqual({ user: "jane", host: "social.example.net" });
    expect(parseFediHandle("@ann.bsky.social")).toBeNull();
  });
});
