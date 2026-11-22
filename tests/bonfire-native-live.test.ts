import { describe, expect, test } from "bun:test";
import {
  hydrateNativeBonfireHome,
  nativeLatestPreview,
  readStatuses,
  type NativeBonfirePage,
} from "../src/lib/bonfire-private.server";
import {
  nativeCardsToRead,
  nativeNewPosts,
  withNativeDetails,
} from "../src/lib/bonfire-native-presentation";
import type { NativeBonfireSnapshot } from "../src/lib/bonfire-private.functions";
import type { FedizenPost } from "../src/lib/fedizen-feed";

const pageInfo = { endCursor: "c1", startCursor: "c0", hasNextPage: false, hasPreviousPage: false };
const author = {
  character: { username: "ann", canonicalUri: "https://fedizen.net/users/ann" },
  profile: { name: "Ann", icon: "https://fedizen.net/a.png" },
};
const relay = {
  character: { username: "relay@bsky.brid.gy", canonicalUri: "https://bsky.brid.gy/r" },
  profile: { name: "Relay", icon: "https://bsky.brid.gy/r.png" },
};
const node = (id: string, objectId: string, extra: object = {}) => ({
  id,
  objectPostContent: { htmlBody: `<p>${id}</p>` },
  subject: author,
  object: { id: objectId, creator: author },
  ...extra,
});
const page = (nodes: NativeBonfirePage["nodes"]): NativeBonfirePage => ({ nodes, pageInfo });
const rest = (statusId: string): FedizenPost => ({
  id: statusId,
  statusId,
  author: "Ann",
  handle: "@ann@fedizen.net",
  paragraphs: ["rest"],
  url: `https://fedizen.net/post/${statusId}`,
  liked: true,
  visibility: "public",
});
const snapshot = (posts: FedizenPost[]): NativeBonfireSnapshot => ({
  status: "available",
  identity: {
    accountId: "a",
    user: { id: "u", character: { username: "damon", canonicalUri: null }, profile: null },
  },
  restAccountHandle: "damon",
  posts,
  notices: [],
  homeEndCursor: null,
  homeHasNextPage: false,
  notificationEndCursor: null,
  notificationHasNextPage: false,
});

describe("cards not read in time are read right after", () => {
  test("an unread card keeps its status id to read later, and its booster", async () => {
    const [card] = await hydrateNativeBonfireHome(
      page([node("act-1", "01SLOW", { verb: { verb: "Boost" }, subject: relay })]),
      async () => undefined,
    );
    expect(card.statusId).toBeUndefined();
    expect(card.statusRef).toBe("01SLOW");
    expect(card.booster?.name).toBe("Relay");
    expect(nativeCardsToRead(snapshot([card]))).toEqual(["01SLOW"]);
  });

  test("its details replace it in place, keeping the GraphQL id and booster", () => {
    const unread: FedizenPost = {
      id: "act-1",
      statusRef: "01SLOW",
      author: "Ann",
      handle: "@ann",
      paragraphs: ["graphql"],
      url: "u",
      boostedBy: "Relay",
      booster: { name: "Relay", acct: "relay@bsky.brid.gy" },
    };
    const read: FedizenPost = {
      id: "act-2",
      statusId: "01READ",
      author: "B",
      handle: "@b",
      paragraphs: ["x"],
      url: "v",
    };
    const out = withNativeDetails(snapshot([unread, read]), { "01SLOW": rest("01SLOW") })!;
    expect(out.posts[0]).toMatchObject({
      id: "act-1",
      statusId: "01SLOW",
      liked: true,
      visibility: "public",
      boostedBy: "Relay",
    });
    expect(out.posts[0].statusRef).toBeUndefined();
    expect(out.posts[1]).toBe(read);
    expect(nativeCardsToRead(out)).toEqual([]);
  });

  test("no details yet, or not available: the snapshot is unchanged", () => {
    const s = snapshot([]);
    expect(withNativeDetails(s, undefined)).toBe(s);
    expect(withNativeDetails(s, {})).toBe(s);
    const off = { ...s, status: "disabled" as const };
    expect(withNativeDetails(off, { x: rest("x") })).toBe(off);
    expect(nativeCardsToRead(off)).toEqual([]);
  });

  test("at most 20 are asked for at once", () => {
    const many = Array.from(
      { length: 30 },
      (_, i): FedizenPost => ({
        id: `a${i}`,
        statusRef: `01R${i}`,
        author: "A",
        handle: "@a",
        paragraphs: ["x"],
        url: "u",
      }),
    );
    expect(nativeCardsToRead(snapshot(many))).toHaveLength(20);
  });

  test("readStatuses skips unsafe ids, repeats and failures", async () => {
    const asked: string[] = [];
    const found = await readStatuses(
      ["01A", "01A", "../x", "01FAIL"],
      async (id) => {
        asked.push(id);
        if (id === "01FAIL") throw new Error("down");
        return rest(id);
      },
      1000,
    );
    expect(asked.sort()).toEqual(["01A", "01FAIL"]);
    expect([...found.keys()]).toEqual(["01A"]);
  });
});

describe("new posts on native Home", () => {
  const p = (id: string): FedizenPost => ({
    id,
    author: id,
    handle: `@${id}`,
    paragraphs: ["x"],
    url: id,
  });
  test("those above the first post already shown are new", () => {
    expect(nativeNewPosts([p("n2"), p("n1"), p("a"), p("b")], [p("a"), p("b")])).toEqual({
      fresh: [p("n2"), p("n1")],
      gap: false,
    });
  });
  test("nothing new when the top is the same", () => {
    expect(nativeNewPosts([p("a"), p("b")], [p("a"), p("b")])).toEqual({ fresh: [], gap: false });
  });
  test("none of the newest page shown: all of it is new, with maybe more between", () => {
    expect(nativeNewPosts([p("x"), p("y")], [p("a")])).toEqual({
      fresh: [p("x"), p("y")],
      gap: true,
    });
  });
  test("no feed yet: nothing is new", () => {
    expect(nativeNewPosts([p("x")], [])).toEqual({ fresh: [], gap: false });
  });
  test("the preview needs no per-post reads and carries who boosted", () => {
    const [card] = nativeLatestPreview(
      page([node("act-9", "01NEW", { verb: { verb: "Announce" }, subject: relay })]),
    );
    expect(card).toMatchObject({ id: "act-9", statusRef: "01NEW", boostedBy: "Relay" });
    expect(card.booster?.avatar).toBe("https://bsky.brid.gy/r.png");
  });
});
