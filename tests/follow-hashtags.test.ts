import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fedizenGet, fedizenSend } from "../src/lib/fedizen.server";

describe("Following hashtags goes through Mastodon's routes, allowlisted", () => {
  const realFetch = globalThis.fetch;
  afterEach(() => { globalThis.fetch = realFetch; });
  const answer = (body: unknown) => (async () => new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } })) as unknown as typeof fetch;

  test("follow and unfollow a tag (any script), with no body", async () => {
    globalThis.fetch = answer({ name: "café", following: true });
    const r = await fedizenSend("t", "POST", `/api/v1/tags/${encodeURIComponent("café")}/follow`);
    expect(r.status).toBe(200);
    expect(r.data?.following).toBe(true);
    globalThis.fetch = answer({ name: "linux", following: false });
    expect((await fedizenSend("t", "POST", "/api/v1/tags/linux/unfollow")).data?.following).toBe(false);
  });

  test("other tag writes, bodies and methods are refused", async () => {
    await expect(fedizenSend("t", "POST", "/api/v1/tags/linux/feature")).rejects.toThrow("Unsupported Fedizen write path.");
    await expect(fedizenSend("t", "DELETE", "/api/v1/tags/linux/follow")).rejects.toThrow("Unsupported Fedizen write path.");
    await expect(fedizenSend("t", "POST", "/api/v1/tags/linux/follow", { x: 1 })).rejects.toThrow("Unsupported Fedizen write body.");
    await expect(fedizenSend("t", "POST", "/api/v1/tags/../accounts/1/follow")).rejects.toThrow("Unsupported Fedizen write path.");
  });

  test("the full followed list is one page of up to 200 (Bonfire's maximum)", async () => {
    globalThis.fetch = answer(Array.from({ length: 200 }, (_, i) => ({ name: `t${i}` })));
    expect((await fedizenGet("t", "/api/v1/followed_tags?limit=200")).status).toBe(200);
    await expect(fedizenGet("t", "/api/v1/followed_tags?limit=201")).rejects.toThrow("Unsupported Fedizen read path.");
  });
});

describe("Follow lives where Mastodon puts it", () => {
  test("phone tag page has Follow / Following at the top right; Settings lists followed hashtags", () => {
    const tagFeed = readFileSync("src/components/f7/TagFeed.tsx", "utf8");
    expect(tagFeed).toMatch(/<NavRight>[\s\S]*\{following \? 'Following' : 'Follow'\}/);
    expect(tagFeed).toContain("export function FollowedTagsPage");
    expect(readFileSync("src/components/f7/AtlasMobileApp.tsx", "utf8")).toMatch(/path: '\/followed-tags\/', component: FollowedTagsPage/);
  });
  test("desktop tag page and Settings → Followed hashtags", () => {
    expect(readFileSync("src/routes/tags.$tag.tsx", "utf8")).toContain("<FollowTagButton");
    expect(readFileSync("src/components/social/Preferences.tsx", "utf8")).toContain('to="/settings/hashtags"');
  });
});
