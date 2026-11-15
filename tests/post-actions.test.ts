import { describe, expect, test } from "bun:test";
import { compactCount, replyMention, replyVisibility } from "../src/lib/post-actions";
import { _clearSeenForTests, _readSeenForTests, hasNew, markFeedSeen, newestOf, shortAgo } from "../src/lib/feed-types";
import { fromStatuses } from "../src/lib/fedizen-feed";

describe("Post actions", () => {
  test("a reply keeps the post's audience; unknown is never wider than unlisted", () => {
    expect(replyVisibility({ id: "1", visibility: "private" })).toBe("private");
    expect(replyVisibility({ id: "1", visibility: "direct" })).toBe("direct");
    expect(replyVisibility({ id: "1" })).toBe("unlisted");
    expect(replyVisibility({ id: "g-1" })).toBe("public");
  });
  test("the reply starts with the author's handle, short for Fedizen's own", () => {
    expect(replyMention("@rosa@fedizen.net")).toBe("@rosa ");
    expect(replyMention("@ann@mastodon.social")).toBe("@ann@mastodon.social ");
    expect(replyMention("@")).toBe("");
    expect(replyMention("@a b@x")).toBe("");
  });
  test("counts are compact and zero shows nothing", () => {
    expect(compactCount(0)).toBe("");
    expect(compactCount(7)).toBe("7");
    expect(compactCount(1234)).toMatch(/^1\.2\s?K$/i);
  });
  test("statuses carry counts, the person's reactions, audience and the preview's image and summary", () => {
    const [p] = fromStatuses([{ id: "1", content: "<p>hi</p>", replies_count: 3, reblogs_count: 2, favourites_count: 9, favourited: true, reblogged: false, visibility: "private",
      card: { url: "https://news.org/a", title: "A story", description: "What happened", image: "https://news.org/a.jpg", provider_name: "News" } } as never]);
    expect(p.counts).toEqual({ replies: 3, boosts: 2, likes: 9 });
    expect(p.liked).toBe(true);
    expect(p.boosted).toBeUndefined();
    expect(p.visibility).toBe("private");
    expect(p.article).toMatchObject({ title: "A story", description: "What happened", image: "https://news.org/a.jpg", provider: "News" });
    const [q] = fromStatuses([{ id: "2", content: "<p>x</p>", card: { url: "https://news.org/b", title: "B", image: "http://insecure/x.jpg" } } as never]);
    expect(q.article?.image).toBeUndefined();
    expect(q.counts).toBeUndefined();
  });
});

describe("New since your last visit", () => {
  test("the newest date, and a dot only when something is newer than what was seen", () => {
    expect(newestOf([{ date: "2026-11-15T10:00:00Z" }, { date: "2026-11-15T12:00:00Z" }, {}])).toBe("2026-11-15T12:00:00Z");
    expect(newestOf([])).toBeUndefined();
    expect(hasNew(undefined, "2026-11-15T12:00:00Z")).toBe(false);
    expect(hasNew("2026-11-15T12:00:00Z", "2026-11-15T12:00:00Z")).toBe(false);
    expect(hasNew("2026-11-15T11:00:00Z", "2026-11-15T12:00:00Z")).toBe(true);
  });
  test("seen never moves backwards and only known feeds are kept", () => {
    _clearSeenForTests();
    markFeedSeen("u", "foryou", "2026-11-15T12:00:00Z");
    markFeedSeen("u", "foryou", "2026-11-15T09:00:00Z");
    markFeedSeen("u", "nope" as never, "2026-11-15T12:00:00Z");
    markFeedSeen("u", "circle:01ABC", "2026-11-15T08:00:00Z");
    markFeedSeen("u", "local", "not a date");
    expect(_readSeenForTests("u")).toEqual({ foryou: "2026-11-15T12:00:00Z", "circle:01ABC": "2026-11-15T08:00:00Z" });
    expect(_readSeenForTests("other")).toEqual({});
  });
  test("short times", () => {
    const now = Date.parse("2026-11-15T12:00:00Z");
    expect(shortAgo("2026-11-15T11:59:30Z", now)).toBe("now");
    expect(shortAgo("2026-11-15T11:55:00Z", now)).toBe("5m");
    expect(shortAgo("2026-11-15T09:00:00Z", now)).toBe("3h");
    expect(shortAgo("2026-11-13T12:00:00Z", now)).toBe("2d");
    expect(shortAgo(undefined, now)).toBe("");
  });
});
