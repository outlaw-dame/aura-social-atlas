import { describe, expect, test } from "bun:test";
import { newPostFaces, newPostsLabel } from "../src/lib/new-post-faces";
import type { FedizenPost } from "../src/lib/fedizen-feed";

const post = (id: string, author: string, acct: string, extra: Partial<FedizenPost> = {}): FedizenPost => ({
  id,
  author,
  acct,
  handle: `@${acct}`,
  avatar: `https://example.social/${id}.png`,
  paragraphs: ["hi"],
  url: `https://example.social/${id}`,
  ...extra,
});

describe("faces on the new-posts pill", () => {
  test("up to three different people, newest first", () => {
    const faces = newPostFaces([
      post("1", "Ann", "ann@a.social"),
      post("2", "Ben", "ben@b.social"),
      post("3", "Ann again", "ANN@a.social"),
      post("4", "Cat", "cat@c.social"),
      post("5", "Dan", "dan@d.social"),
    ]);
    expect(faces.map((f) => f.name)).toEqual(["Ann", "Ben", "Cat"]);
  });

  test("a boost shows who boosted it, not the original author", () => {
    const [face] = newPostFaces([
      post("1", "Stranger", "stranger@far.social", {
        booster: { name: "Friend", acct: "friend@fedizen.net", avatar: "https://fedizen.net/f.png" },
      }),
    ]);
    expect(face).toEqual({ key: "friend@fedizen.net", name: "Friend", avatar: "https://fedizen.net/f.png" });
  });

  test("someone without a picture keeps their place (shown as an initial)", () => {
    const faces = newPostFaces([post("1", "Ann", "ann@a.social", { avatar: undefined })]);
    expect(faces).toEqual([{ key: "ann@a.social", name: "Ann" }]);
  });

  test("nothing waiting, no faces", () => {
    expect(newPostFaces([])).toEqual([]);
  });
});

describe("what a screen reader hears", () => {
  const faces = [
    { key: "a", name: "Ann" },
    { key: "b", name: "Ben" },
  ];
  test("count and names", () => {
    expect(newPostsLabel(2, false, faces)).toBe("Show 2 new posts from Ann and Ben");
    expect(newPostsLabel(1, false, faces.slice(0, 1))).toBe("Show 1 new post from Ann");
  });
  test("more posts than faces, or a gap, says and others", () => {
    expect(newPostsLabel(7, false, faces)).toBe("Show 7 new posts from Ann, Ben and others");
    expect(newPostsLabel(20, true, faces)).toBe("Show 20+ new posts from Ann, Ben and others");
  });
  test("without faces it still says how many", () => {
    expect(newPostsLabel(3, false, [])).toBe("Show 3 new posts");
  });
});
