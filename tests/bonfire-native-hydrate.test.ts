import { describe, expect, test } from "bun:test";
import {
  hydrateNativeBonfireHome,
  type NativeBonfirePage,
} from "../src/lib/bonfire-private.server";
import type { FedizenPost } from "../src/lib/fedizen-feed";

const pageInfo = { endCursor: "c1", startCursor: "c0", hasNextPage: true, hasPreviousPage: false };

const author = {
  character: { username: "ann", canonicalUri: "https://fedizen.net/users/ann" },
  profile: { name: "Ann", icon: "https://fedizen.net/a.png" },
};
const booster = {
  character: { username: "ben@mastodon.social", canonicalUri: "https://mastodon.social/users/ben" },
  profile: { name: "Ben", icon: "https://files.mastodon.social/ben.png" },
};

const page = (nodes: NativeBonfirePage["nodes"]): NativeBonfirePage => ({ nodes, pageInfo });
const post = (id: string, objectId: string | undefined, extra: object = {}) => ({
  id,
  date: "2026-11-22T10:00:00Z",
  objectPostContent: { htmlBody: `<p>native ${id}</p>` },
  subject: author,
  ...(objectId ? { object: { id: objectId, creator: author } } : {}),
  ...extra,
});

/** A REST status as fromStatuses would give it: everything the feed card needs. */
const restPost = (statusId: string): FedizenPost => ({
  id: statusId,
  statusId,
  author: "Ann",
  handle: "@ann@fedizen.net",
  paragraphs: [`rest ${statusId}`],
  url: `https://fedizen.net/post/${statusId}`,
  date: "2026-11-22T09:59:00Z",
  visibility: "public",
  language: "en",
  counts: { replies: 2, boosts: 1, likes: 5 },
  liked: true,
  boosted: false,
  bookmarked: true,
  cw: "spoilers",
});

describe("native Home shows the same cards as the REST feed", () => {
  test("each post takes its REST details, keeping GraphQL's order and ids", async () => {
    const reads: string[] = [];
    const posts = await hydrateNativeBonfireHome(
      page([post("act-1", "01POSTONE"), post("act-2", "01POSTTWO")]),
      async (id) => {
        reads.push(id);
        return restPost(id);
      },
    );
    expect(posts.map((p) => p.id)).toEqual(["act-1", "act-2"]);
    expect(posts.map((p) => p.statusId)).toEqual(["01POSTONE", "01POSTTWO"]);
    expect(posts[0]).toMatchObject({
      visibility: "public",
      language: "en",
      liked: true,
      bookmarked: true,
      cw: "spoilers",
      counts: { replies: 2, boosts: 1, likes: 5 },
      date: "2026-11-22T09:59:00Z",
    });
    expect(reads.sort()).toEqual(["01POSTONE", "01POSTTWO"]);
  });

  test("a boost keeps who boosted it", async () => {
    const [p] = await hydrateNativeBonfireHome(
      page([post("act-b", "01BOOSTED", { verb: { verb: "Boost" }, subject: booster })]),
      async (id) => restPost(id),
    );
    expect(p.statusId).toBe("01BOOSTED");
    expect(p.boostedBy).toBe("Ben");
    expect(p.booster).toEqual({
      name: "Ben",
      avatar: "https://files.mastodon.social/ben.png",
      acct: "ben@mastodon.social",
      actor: "https://mastodon.social/users/ben",
    });
  });

  test("a local booster gets a full handle and Fedizen's placeholder picture is dropped", async () => {
    const local = {
      character: { username: "cat", canonicalUri: "https://fedizen.net/users/cat" },
      profile: { name: "Cat", icon: "https://fedizen.net/images/avatar.png" },
    };
    const [p] = await hydrateNativeBonfireHome(
      page([post("act-c", "01BOOSTED", { verb: { verb: "Announce" }, subject: local })]),
      async (id) => restPost(id),
    );
    expect(p.booster).toEqual({
      name: "Cat",
      acct: "cat@fedizen.net",
      actor: "https://fedizen.net/users/cat",
    });
  });

  test("a failed, refused or missing read leaves the GraphQL card with Share only", async () => {
    const posts = await hydrateNativeBonfireHome(
      page([
        post("act-1", "01FAILS"),
        post("act-2", "01GONE"),
        post("act-3", undefined),
        post("act-4", "../evil"),
      ]),
      async (id) => {
        if (id === "01FAILS") throw new Error("network");
        return undefined;
      },
    );
    expect(posts).toHaveLength(4);
    for (const p of posts) {
      expect(p.statusId).toBeUndefined();
      expect(p.liked).toBeUndefined();
      expect(p.paragraphs[0]).toContain("native");
    }
  });

  test("an unsafe id is never read", async () => {
    const reads: string[] = [];
    await hydrateNativeBonfireHome(page([post("act-x", "a/b?c")]), async (id) => {
      reads.push(id);
      return restPost(id);
    });
    expect(reads).toEqual([]);
  });

  test("reads past the time budget are not sent, and slow posts stay GraphQL-only", async () => {
    const started: string[] = [];
    const nodes = Array.from({ length: 6 }, (_, i) => post(`act-${i}`, `01SLOW${i}`));
    const posts = await hydrateNativeBonfireHome(
      page(nodes),
      async (id) => {
        started.push(id);
        await new Promise((r) => setTimeout(r, id === "01SLOW0" ? 10 : 200));
        return restPost(id);
      },
      50,
      1,
    );
    // One at a time: the fast first read lands, the second is still running at the deadline, the rest never start.
    expect(started).toEqual(["01SLOW0", "01SLOW1"]);
    expect(posts[0].statusId).toBe("01SLOW0");
    expect(posts.slice(1).every((p) => p.statusId === undefined)).toBe(true);
  });

  test("reads run at most `concurrency` at a time", async () => {
    let running = 0;
    let peak = 0;
    const nodes = Array.from({ length: 20 }, (_, i) => post(`act-${i}`, `01P${i}`));
    await hydrateNativeBonfireHome(page(nodes), async (id) => {
      running += 1;
      peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, 5));
      running -= 1;
      return restPost(id);
    });
    expect(peak).toBe(8);
  });

  test("a post GraphQL repeats on the page is shown and read once", async () => {
    const reads: string[] = [];
    const posts = await hydrateNativeBonfireHome(
      page([
        post("act-1", "01SAME"),
        post("act-2", "01SAME", { verb: { verb: "Boost" }, subject: booster }),
      ]),
      async (id) => {
        reads.push(id);
        return restPost(id);
      },
    );
    expect(posts).toHaveLength(1);
    expect(reads).toEqual(["01SAME"]);
  });
});

describe("posts without text", () => {
  test("an image-only post still gets its REST card; unread, GraphQL has nothing to show", async () => {
    const imageOnly = {
      id: "act-img",
      object: { id: "01IMAGE", creator: author },
      subject: author,
      objectPostContent: { htmlBody: "" },
      media: [{ url: "https://fedizen.net/i.png", mediaType: "image/png" }],
    };
    const hydrated = await hydrateNativeBonfireHome(page([imageOnly]), async (id) => ({
      ...restPost(id),
      paragraphs: [],
      image: "https://fedizen.net/i.png",
    }));
    expect(hydrated.map((p) => [p.id, p.statusId])).toEqual([["act-img", "01IMAGE"]]);
    expect(await hydrateNativeBonfireHome(page([imageOnly]), async () => undefined)).toEqual([]);
  });
});
