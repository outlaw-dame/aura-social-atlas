import { afterEach, describe, expect, test } from "bun:test";
import { groupAccessLabel, groupFromBonfire, groupHandle, groupsFromBonfire, joinModeOf, mediaUrl } from "../src/lib/groups";
import { getGroup, latestInGroups, net } from "../src/lib/groups.server";

/* Boundary dimensions of Bonfire v1.1.0-rc.1's group presets (bonfire_classify RuntimeConfig.group_presets). */
const presets = {
  open_network: { membership: "open", visibility: "global", participation: "anyone" },
  local_community: { membership: "local:members", visibility: "nonfederated:preview", participation: "local:contributors" },
  announcement_channel: { membership: "invite_only", visibility: "global", participation: "moderators" },
  private_club: { membership: "on_request", visibility: "local:preview", participation: "group_members" },
};
const category = (dims: Record<string, string>, extra: Record<string, unknown> = {}) => ({
  id: "01JGROUPAAAAAAAAAAAAAAAAAA", name: "Gardeners", summary: "<p>Seeds &amp; soil.</p><p>Swap day Sundays.</p>", type: "group",
  membersCount: 42, isDisabled: false, parentCategoryId: null,
  boundaries: Object.entries(dims).map(([key, slug]) => ({ key, slug })),
  character: { username: "gardeners", canonicalUri: "https://fedizen.net/pub/actors/gardeners" },
  profile: { name: "Gardeners", icon: "/data/uploads/icon.png", image: "https://fedizen.net/data/banner.jpg" },
  ...extra,
});

describe("groupFromBonfire", () => {
  test("maps an open, federated group", () => {
    const g = groupFromBonfire(category(presets.open_network))!;
    expect(g).toMatchObject({ name: "Gardeners", type: "group", username: "gardeners", host: "fedizen.net", members: 42, joinMode: "open", federated: true, announcements: false, membersOnlyContent: false });
    expect(g.url).toBe("https://fedizen.net/group/gardeners");
    expect(g.summary).toEqual(["Seeds & soil.", "Swap day Sundays."]);
    expect(g.avatar).toBe("https://fedizen.net/data/uploads/icon.png");
    expect(groupHandle(g)).toBe("&gardeners@fedizen.net");
    expect(groupAccessLabel(g)).toBe("Open to everyone");
  });

  test("reads each Bonfire preset", () => {
    const label = (k: keyof typeof presets) => groupAccessLabel(groupFromBonfire(category(presets[k]))!);
    expect(label("local_community")).toBe("Fedizen members can join");
    expect(label("announcement_channel")).toBe("Announcement channel");
    expect(label("private_club")).toBe("Private · request to join");
    const club = groupFromBonfire(category(presets.private_club))!;
    expect(club).toMatchObject({ joinMode: "request", membersOnlyContent: true, federated: false });
  });

  test("a group mirrored from another server keeps its host and address", () => {
    const g = groupFromBonfire(category(presets.open_network, { character: { username: "technology@lemmy.world", canonicalUri: "https://lemmy.world/c/technology" } }))!;
    expect(g.host).toBe("lemmy.world");
    expect(groupHandle(g)).toBe("&technology@lemmy.world");
  });

  test("topics use the + address and link", () => {
    const t = groupFromBonfire(category({}, { type: "topic", character: { username: "seeds" }, parentCategoryId: "01JGROUPAAAAAAAAAAAAAAAAAA" }))!;
    expect(t.type).toBe("topic");
    expect(t.url).toBe("https://fedizen.net/+seeds");
    expect(groupHandle(t)).toBe("+seeds@fedizen.net");
  });

  test("rejects unusable entries and unsafe values", () => {
    expect(groupFromBonfire(null)).toBeNull();
    expect(groupFromBonfire({ id: "x y", name: "Bad id" })).toBeNull();
    expect(groupFromBonfire({ id: "abc" })).toBeNull();
    const g = groupFromBonfire(category({}, { character: { username: "evil/../x" }, profile: { icon: "javascript:alert(1)", image: "http://plain.example/b.jpg" } }))!;
    expect(g.username).toBeUndefined();
    expect(g.url).toBe("https://fedizen.net/group/01JGROUPAAAAAAAAAAAAAAAAAA");
    expect(g.avatar).toBeUndefined();
    expect(g.banner).toBeUndefined();
  });

  test("unknown membership falls back to open, as Bonfire's own adapter does", () => {
    expect(joinModeOf(undefined)).toBe("open");
    expect(joinModeOf("something_new")).toBe("open");
  });

  test("mediaUrl only allows https or Fedizen paths", () => {
    expect(mediaUrl("//evil.example/x.png")).toBeUndefined();
    expect(mediaUrl("/x.png")).toBe("https://fedizen.net/x.png");
  });
});

describe("groupsFromBonfire", () => {
  test("drops archived groups, lists groups before topics, biggest first", () => {
    const list = groupsFromBonfire([
      category({}, { id: "small", membersCount: 3 }),
      category({}, { id: "topic1", type: "topic" }),
      category({}, { id: "big", membersCount: 300 }),
      category({}, { id: "gone", isDisabled: true }),
      "nonsense",
    ]);
    expect(list.map(g => g.id)).toEqual(["big", "small", "topic1"]);
  });
});

describe("groups.server", () => {
  afterEach(() => { net.fetch = undefined; });
  const reply = (data: unknown) => new Response(JSON.stringify({ data }), { headers: { "content-type": "application/json" } });

  test("getGroup returns the group, its topics and its posts, crediting the group not a booster", async () => {
    const bodies: { query: string; variables: Record<string, unknown> }[] = [];
    net.fetch = (async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      bodies.push(body);
      if (body.query.includes("category(categoryId")) return reply({ category: category(presets.open_network) });
      if (body.query.includes("categories(")) return reply({ categories: { edges: [category({}, { id: "t1", type: "topic", parentCategoryId: "01JGROUPAAAAAAAAAAAAAAAAAA", character: { username: "seeds" } }), category({}, { id: "other" })] } });
      return reply({ feedActivities: { edges: [{ node: {
        id: "a1", verb: { verb: "Boost" }, subject: { character: { username: "gardeners" }, profile: { name: "Gardeners" } },
        objectPostContent: { htmlBody: "<p>Tomatoes are in!</p>" },
        object: { id: "p1", creator: { character: { username: "ana" }, profile: { name: "Ana" } } },
      } }] } });
    }) as typeof fetch;
    const r = await getGroup("01JGROUPAAAAAAAAAAAAAAAAAA");
    if (!r || r === "not-found") throw new Error("expected a group");
    expect(r.group.name).toBe("Gardeners");
    expect(r.topics.map(t => t.id)).toEqual(["t1"]);
    expect(r.posts).toHaveLength(1);
    expect(r.posts[0]).toMatchObject({ author: "Ana", group: "Gardeners", paragraphs: ["Tomatoes are in!"] });
    expect("boostedBy" in r.posts[0]).toBe(false);
    // the id travels as a GraphQL variable, never spliced into the query
    expect(bodies.some(b => b.variables.id === "01JGROUPAAAAAAAAAAAAAAAAAA" && !b.query.includes("01JGROUP"))).toBe(true);
    expect(bodies.some(b => JSON.stringify(b.variables.subjects) === '["01JGROUPAAAAAAAAAAAAAAAAAA"]' && b.query.includes('feedName:"known_groups"'))).toBe(true);
  });

  test("a GraphQL error reads as unavailable, not as an empty list", async () => {
    net.fetch = (async () => new Response(JSON.stringify({ errors: [{ message: "boom" }] }))) as unknown as typeof fetch;
    expect(await latestInGroups()).toBeNull();
    expect(await getGroup("01JGROUPAAAAAAAAAAAAAAAAAA")).toBeNull();
  });

  test("a failed posts read is reported, not shown as an empty group", async () => {
    net.fetch = (async (_url: string, init?: RequestInit) => {
      const q = JSON.parse(String(init?.body)).query as string;
      if (q.includes("feedActivities")) return new Response(JSON.stringify({ errors: [{ message: "timeout" }] }));
      if (q.includes("category(categoryId")) return reply({ category: category(presets.open_network) });
      return reply({ categories: { edges: [] } });
    }) as typeof fetch;
    const r = await getGroup("01JGROUPAAAAAAAAAAAAAAAAAA");
    if (!r || r === "not-found") throw new Error("expected a group");
    expect(r.posts).toEqual([]);
    expect(r.postsError).toBe("unavailable");
  });

  test("a group Fedizen doesn't return is not-found", async () => {
    net.fetch = (async () => new Response(JSON.stringify({ data: { category: null, categories: { edges: [] }, feedActivities: { edges: [] } } }))) as unknown as typeof fetch;
    expect(await getGroup("01JGROUPAAAAAAAAAAAAAAAAAA")).toBe("not-found");
  });
});
