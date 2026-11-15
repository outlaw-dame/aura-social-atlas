import { afterEach, describe, expect, test } from "bun:test";
import { AVATAR_SHAPES, DEFAULT_AVATAR_SHAPE, avatarRadius } from "../src/lib/avatar-shape";
import { followedTagsIn } from "../src/lib/hashtags";
import { fedizenGet } from "../src/lib/fedizen.server";

describe("Avatar shape", () => {
  test("circle by default; rounded and square on offer", () => {
    expect(DEFAULT_AVATAR_SHAPE).toBe("circle");
    expect(AVATAR_SHAPES.map(s => s.id)).toEqual(["circle", "rounded", "square"]);
    expect(avatarRadius("circle")).toBe("50%");
    expect(avatarRadius("square")).toBe("0");
  });
});

describe("Followed hashtags in a post", () => {
  test("only the ones you follow, once each, in the order used, any case", () => {
    const followed = new Set(["linux", "urbanism"]);
    expect(followedTagsIn(["New tram! #Urbanism #transit", "and #linux, #LINUX again"], followed)).toEqual(["urbanism", "linux"]);
    expect(followedTagsIn(["nothing here"], followed)).toEqual([]);
    expect(followedTagsIn(["#linux"], new Set())).toEqual([]);
  });
});

describe("Hashtag reads are allowlisted", () => {
  const realFetch = globalThis.fetch;
  afterEach(() => { globalThis.fetch = realFetch; });
  test("all followed tags (up to 100) and a tag's feed of 20", async () => {
    globalThis.fetch = (async () => new Response("[]", { headers: { "content-type": "application/json" } })) as unknown as typeof fetch;
    expect((await fedizenGet("t", "/api/v1/followed_tags?limit=100")).status).toBe(200);
    expect((await fedizenGet("t", `/api/v1/timelines/tag/${encodeURIComponent("café")}?limit=20`)).status).toBe(200);
    await expect(fedizenGet("t", "/api/v1/followed_tags?limit=500")).rejects.toThrow("Unsupported Fedizen read path.");
    await expect(fedizenGet("t", "/api/v1/timelines/tag/linux?limit=40")).rejects.toThrow("Unsupported Fedizen read path.");
  });
});
