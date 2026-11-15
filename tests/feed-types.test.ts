import { afterEach, describe, expect, test } from "bun:test";
import { BASE_FEEDS, circleIdOf, fromGroupPost, rankForYou } from "../src/lib/feed-types";
import { fedizenGet } from "../src/lib/fedizen.server";
import { joinedGroups, membershipNet, net, popularInGroups } from "../src/lib/groups.server";
import type { FedizenPost } from "../src/lib/fedizen-feed";

const NOW = Date.parse("2026-11-15T16:00:00Z");
const post = (id: string, hoursAgo: number, extra: Partial<FedizenPost> = {}): FedizenPost => ({
  id, statusId: id, author: "A", handle: "@a@x.org", paragraphs: ["hi"], url: `https://x.org/p/${id}`, date: new Date(NOW - hoursAgo * 3600_000).toISOString(), ...extra,
});

describe("Feed kinds", () => {
  test("Following, For You, Articles, Local in that order; circles are circle:<id>", () => {
    expect(BASE_FEEDS.map(f => f.label)).toEqual(["Following", "For You", "Articles", "Local"]);
    expect(circleIdOf("circle:01ABC")).toBe("01ABC");
    expect(circleIdOf("local")).toBeNull();
  });
});

describe("For You ranking", () => {
  test("each post once, with every reason it's there", () => {
    const shared = post("1", 1);
    const out = rankForYou({ following: [shared], tags: [{ tag: "linux", posts: [shared] }], groups: [] }, NOW);
    expect(out).toHaveLength(1);
    expect(out[0].reasons).toEqual([{ kind: "following" }, { kind: "tag", tag: "linux" }]);
  });

  test("newer first, a group's most-discussed post rises, and stale posts sink", () => {
    const out = rankForYou({
      following: [post("old", 60), post("new", 1)],
      tags: [{ tag: "art", posts: [post("tag", 3)] }],
      groups: [{ ...post("hot", 20), group: "Makers" }, { ...post("cold", 20), group: "Makers" }],
    }, NOW);
    const order = out.map(p => p.id);
    expect(order[0]).toBe("new");
    expect(order.indexOf("hot")).toBeLessThan(order.indexOf("cold"));
    expect(order.at(-1)).toBe("old");
    expect(out.find(p => p.id === "hot")?.reasons).toEqual([{ kind: "group", group: "Makers" }]);
  });

  test("group posts become feed posts without a status id (they can't be saved from here)", () => {
    expect(fromGroupPost({ id: "9", paragraphs: ["x"], url: "https://fedizen.net/p/9", author: "B", handle: "@b", group: "G" })).toMatchObject({ id: "g-9", url: "https://fedizen.net/p/9" });
    expect(fromGroupPost({ id: "9", paragraphs: [], url: "u", author: "B", handle: "@b" }).statusId).toBeUndefined();
  });

  test("caps the feed", () => {
    const many = Array.from({ length: 60 }, (_, i) => post(String(i), i));
    expect(rankForYou({ following: many, tags: [], groups: [] }, NOW)).toHaveLength(40);
  });
});

describe("Feed reads are allowlisted", () => {
  const realFetch = globalThis.fetch;
  afterEach(() => { globalThis.fetch = realFetch; });
  test("followed hashtags, a hashtag timeline (any script, percent-encoded) and a circle timeline", async () => {
    const seen: string[] = [];
    globalThis.fetch = (async (url: string) => { seen.push(url); return new Response("[]", { headers: { "content-type": "application/json" } }); }) as unknown as typeof fetch;
    expect((await fedizenGet("t", "/api/v1/followed_tags?limit=20")).status).toBe(200);
    expect((await fedizenGet("t", `/api/v1/timelines/tag/${encodeURIComponent("café")}?limit=10`)).status).toBe(200);
    expect((await fedizenGet("t", `/api/v1/timelines/tag/${encodeURIComponent("日".repeat(100))}?limit=10`)).status).toBe(200);
    expect((await fedizenGet("t", "/api/v1/timelines/list/01HABCDEF?limit=20")).status).toBe(200);
    await expect(fedizenGet("t", "/api/v1/timelines/tag/a/b?limit=10")).rejects.toThrow("Unsupported Fedizen read path.");
    await expect(fedizenGet("t", "/api/v1/timelines/list/x?limit=40")).rejects.toThrow("Unsupported Fedizen read path.");
    await expect(fedizenGet("t", "/api/v1/timelines/public?limit=20")).rejects.toThrow("Unsupported Fedizen read path.");
    expect(seen).toHaveLength(4);
  });
});

describe("Popular in your groups", () => {
  afterEach(() => { net.fetch = undefined; membershipNet.token = undefined; membershipNet.get = undefined; });
  test("asks Bonfire for the week's most-replied posts in exactly those groups", async () => {
    let body: { query: string; variables: { subjects: string[] } } | undefined;
    net.fetch = (async (_u: string, init?: RequestInit) => { body = JSON.parse(String(init?.body)); return new Response(JSON.stringify({ data: { feedActivities: { edges: [] } } })); }) as unknown as typeof fetch;
    expect(await popularInGroups(["g1", "g2"])).toEqual([]);
    expect(body?.query).toContain("sortBy:REPLY_COUNT");
    expect(body?.query).toContain("sortOrder:DESC");
    expect(body?.query).toContain("timeLimit:7");
    expect(body?.variables.subjects).toEqual(["g1", "g2"]);
    expect(await popularInGroups([])).toEqual([]);
  });

  test("joined groups are the ones whose relationship says you follow (are a member of) them", async () => {
    net.fetch = (async () => new Response(JSON.stringify({ data: { categories: { pageInfo: { hasNextPage: false }, edges: [
      { id: "g1", name: "Makers", type: "group", profile: { name: "Makers" } },
      { id: "g2", name: "Readers", type: "group", profile: { name: "Readers" } },
    ] } } }))) as unknown as typeof fetch;
    membershipNet.token = async () => ({ access_token: "t", scope: "read write follow" });
    membershipNet.get = (async () => ({ status: 200, data: [{ id: "g1", following: true }, { id: "g2", following: false }] })) as never;
    expect((await joinedGroups("u"))?.map(g => g.id)).toEqual(["g1"]);
  });
});
