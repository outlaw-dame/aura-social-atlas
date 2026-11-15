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

describe("Avatar shape reaches every avatar", () => {
  const { readFileSync, readdirSync } = require("node:fs") as typeof import("node:fs");
  const { join } = require("node:path") as typeof import("node:path");
  const walk = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(join(d, e.name)) : e.name.endsWith(".tsx") ? [join(d, e.name)] : []);
  // The mini player shows episode artwork, a picture rather than an avatar, so it keeps its own corners.
  const ARTWORK = new Set(["src/components/social/MiniPlayer.tsx"]);
  const files = [...walk("src/components/social"), ...walk("src/components/f7"), ...walk("src/routes")].filter(f => !ARTWORK.has(f));

  test("no avatar or initial is drawn with a fixed Tailwind radius", () => {
    const offenders: string[] = [];
    for (const f of files) {
      readFileSync(f, "utf8").split("\n").forEach((line, i) => {
        // An image or initial tile with a fixed rounding and an avatar-ish source or fallback letter.
        for (const tag of line.match(/<(img|span|div)\b[^>]*>/g) ?? []) {
          if (!/rounded-(full|lg|xl|2xl|md|\[)/.test(tag) || /atlas-avatar/.test(tag)) continue;
          const avatarish = /avatar|preset\.src|\bme\.src/i.test(tag) || (/size-\d+/.test(tag) && /bg-muted/.test(tag) && /aria-hidden/.test(tag) && !/px-/.test(tag));
          if (avatarish) offenders.push(`${f}:${i + 1}`);
        }
      });
    }
    expect(offenders).toEqual([]);
  });

  test("avatar CSS rules use --atlas-avatar-radius", () => {
    const css = readFileSync("src/styles.css", "utf8");
    const offenders: string[] = [];
    for (const m of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
      const [sel, body] = [m[1].trim(), m[2]];
      const r = body.match(/border-radius:\s*([^;]+)/)?.[1].trim();
      if (!r || r.includes("--atlas-avatar-radius")) continue;
      // Episode artwork and the mini player's art keep their own corners.
      if (/mini-open|episode-art|now-art/.test(sel)) continue;
      if (/avatar|-initial|-face\b|coll-by img|item-media img|article-author img|fedi-head > img|mention-bar button img/.test(sel)) offenders.push(sel);
    }
    expect(offenders).toEqual([]);
  });
});
