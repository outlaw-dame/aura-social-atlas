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

describe("A follow isn't undone by a list read already in flight", () => {
  test("cancels the account's followed-tags read before the optimistic change, and reconciles after", () => {
    const src = readFileSync("src/components/social/useTagFollow.ts", "utf8");
    const cancel = src.indexOf("await qc.cancelQueries({ queryKey: k })");
    const snapshot = src.indexOf("const before = qc.getQueryData");
    expect(cancel).toBeGreaterThan(0);
    expect(cancel).toBeLessThan(snapshot);
    expect(src.indexOf("setBusy(lower)")).toBeLessThan(cancel);
    expect(src.match(/invalidateQueries\(\{ queryKey: k \}\)/g)?.length).toBe(3);
  });
});

describe("The Follow button never guesses", () => {
  test("phone and desktop wait for the followed list, offer a retry when it fails, and don't keep a failed read", () => {
    const hook = readFileSync("src/components/social/useTagFollow.ts", "utf8");
    expect(hook).toContain("export function useTagFollowState");
    expect(hook).toMatch(/staleTime: q => \(q\.state\.data\?\.error \? 0 : 5 \* 60_000\)/);
    const phone = readFileSync("src/components/f7/TagFeed.tsx", "utf8");
    expect(phone).toContain("const canFollow = feedOk && state.known;");
    expect(phone).toContain("state.failed");
    const desk = readFileSync("src/routes/tags.$tag.tsx", "utf8");
    expect(desk).toMatch(/followState\.known \? <FollowTagButton/);
    expect(desk).toContain("followState.retry");
  });
});
