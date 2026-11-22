import { beforeEach, describe, expect, test } from "bun:test";
import { parseArticleHead } from "../src/lib/article-author";
import { clearAuthorCache, resolveArticleAuthors, resolveAuthorsFor, type Lookup } from "../src/lib/article-author.server";
import { claimedAcct, postsFromOutbox, profileFromActor } from "../src/lib/fedi-profile";
import { _clearFediProfileCache, bannerFromMastodonApi, loadFediProfile } from "../src/lib/fedi-profile.server";

type Fake = { status?: number; type?: string; body?: unknown; delayMs?: number };
function net(routes: Record<string, Fake>) {
  const seen: string[] = [];
  const fetchImpl = async (url: string, init?: RequestInit) => {
    seen.push(url);
    expect(init?.redirect).toBe("manual");
    const r = routes[url];
    if (!r) return new Response("not found", { status: 404 });
    if (r.delayMs) await new Promise((res) => setTimeout(res, r.delayMs));
    return new Response(typeof r.body === "string" ? r.body : JSON.stringify(r.body), {
      status: r.status ?? 200, headers: { "content-type": r.type ?? "application/activity+json" },
    });
  };
  return { fetchImpl, seen };
}
const dns: Lookup = async () => ["93.184.216.34"];
const PUBLIC = "https://www.w3.org/ns/activitystreams#Public";
const JANE = "https://blog.example.org/wp-json/activitypub/1.0/users/2";
const jane = (extra: Record<string, unknown> = {}) => ({
  id: JANE, type: "Person", preferredUsername: "jane", name: "Jane Writer",
  url: "https://blog.example.org/author/jane/", icon: { type: "Image", url: "https://blog.example.org/jane.png" }, ...extra,
});
beforeEach(() => { clearAuthorCache(); _clearFediProfileCache(); });

describe("ActivityPub accounts behind an article's author links", () => {
  test("reads rel=author from <link> and <a>, resolved against the page", () => {
    const html = `<html><head><link rel="author" href="/author/jane/"></head><body><a rel="author external" href="https://blog.example.org/author/bo/#x">Bo</a></body></html>`;
    expect(parseArticleHead(html, "https://blog.example.org/2026/post/").authorLinks).toEqual([
      "https://blog.example.org/author/jane/", "https://blog.example.org/author/bo/",
    ]);
  });

  test("credits a WordPress-style author page that is the author's actor", async () => {
    const { fetchImpl } = net({
      "https://blog.example.org/2026/post/": { type: "text/html", body: `<head><link rel="author" href="/author/jane/"></head>` },
      "https://blog.example.org/author/jane/": { body: jane() },
    });
    const [a] = await resolveArticleAuthors("https://blog.example.org/2026/post/", fetchImpl, dns);
    expect(a).toMatchObject({ name: "Jane Writer", acct: "@jane@blog.example.org", actor: JANE, verifiedBy: "author-link" });
  });

  test("an off-host author actor must list the article's domain", async () => {
    const page = { type: "text/html", body: `<head><link rel="author" href="https://social.example.net/users/jane"></head>` };
    const other = { id: "https://social.example.net/users/jane", type: "Person", preferredUsername: "jane", name: "Jane" };
    const no = net({ "https://blog.example.org/p": page, "https://social.example.net/users/jane": { body: other } });
    expect(await resolveArticleAuthors("https://blog.example.org/p", no.fetchImpl, dns)).toEqual([]);
    clearAuthorCache();
    const yes = net({ "https://blog.example.org/p": page, "https://social.example.net/users/jane": { body: { ...other, attributionDomains: ["example.org"] } } });
    expect((await resolveArticleAuthors("https://blog.example.org/p", yes.fetchImpl, dns)).map(a => a.acct)).toEqual(["@jane@social.example.net"]);
  });

  test("uses a link preview's author URL as a hint when the page names no one", async () => {
    const { fetchImpl } = net({
      "https://blog.example.org/p": { type: "text/html", body: "<head></head>" },
      "https://blog.example.org/author/jane/": { body: jane() },
    });
    const found = await resolveAuthorsFor(["https://blog.example.org/p"], 2000, fetchImpl, dns, { "https://blog.example.org/p": { authorUrl: "https://blog.example.org/author/jane/" } });
    expect(found.get("https://blog.example.org/p")?.[0]?.verifiedBy).toBe("author-link");
  });

  test("a verified fediverse:creator wins; author links aren't fetched", async () => {
    const { fetchImpl, seen } = net({
      "https://blog.example.org/p": { type: "text/html", body: `<head><meta name="fediverse:creator" content="@jane@blog.example.org"><link rel="author" href="/author/x/"></head>` },
      "https://blog.example.org/.well-known/webfinger?resource=acct%3Ajane%40blog.example.org": { type: "application/jrd+json", body: { links: [{ rel: "self", type: "application/activity+json", href: JANE }] } },
      [JANE]: { body: jane() },
    });
    const [a] = await resolveArticleAuthors("https://blog.example.org/p", fetchImpl, dns);
    expect(a.verifiedBy).toBe("fediverse-creator");
    expect(seen).not.toContain("https://blog.example.org/author/x/");
  });
});

describe("Profiles shown inside Atlas", () => {
  test("maps an actor, stripping markup and lying characters", () => {
    const p = profileFromActor(jane({
      name: "Jane‮ Writer", summary: "<p>Writes <b>things</b>.</p><p>Lives here.</p>", manuallyApprovesFollowers: true,
      attachment: [{ type: "PropertyValue", name: "Site", value: '<a href="https://x.org">x.org</a>' }, { type: "Note", name: "skip" }],
      image: { type: "Image", url: "https://blog.example.org/head.jpg" }, published: "2024-01-02T00:00:00Z",
    }))!;
    expect(p).toMatchObject({ acct: "@jane@blog.example.org", name: "Jane Writer", locked: true, kind: "person", host: "blog.example.org", header: "https://blog.example.org/head.jpg", joined: "2024-01-02T00:00:00Z" });
    expect(p.bio).toEqual(["Writes things.", "Lives here."]);
    expect(p.fields).toEqual([{ name: "Site", value: "x.org" }]);
  });

  test("prefers the actor's own webfinger handle (FEP-2c59)", () => {
    expect(claimedAcct(jane({ webfinger: "acct:jane@example.org" }))).toBe("jane@example.org");
    expect(claimedAcct(jane())).toBe("jane@blog.example.org");
  });

  test("keeps only the author's own public posts; folds content warnings; marks sensitive images for a veil", () => {
    const note = (id: string, o: Record<string, unknown> = {}, act: Record<string, unknown> = {}) => ({
      type: "Create", to: [PUBLIC], ...act,
      object: { id: `https://blog.example.org/n/${id}`, type: "Note", attributedTo: JANE, to: [PUBLIC], content: `<p>post ${id}</p>`, published: "2026-11-01T00:00:00Z", ...o },
    });
    const posts = postsFromOutbox({ orderedItems: [
      note("1"),
      note("2", { to: ["https://blog.example.org/followers"] }, { to: ["https://blog.example.org/followers"] }),
      { type: "Announce", to: [PUBLIC], object: "https://other.example.org/x" },
      note("3", { attributedTo: "https://blog.example.org/users/someone-else" }),
      note("4", { summary: "spoilers", sensitive: true, attachment: [{ type: "Image", mediaType: "image/png", url: "https://blog.example.org/i.png" }] }),
      note("5", { id: "https://evil.example.com/n/5" }),
      { type: "Create", to: [PUBLIC], object: { id: "https://blog.example.org/a/6", type: "Article", attributedTo: JANE, to: [PUBLIC], name: "Long read", summary: "<p>Standfirst</p>", content: "<p>body</p>" } },
    ] }, JANE);
    expect(posts.map(p => p.id.split("/").pop())).toEqual(["1", "4", "6"]);
    expect(posts[1]).toMatchObject({ cw: "spoilers", image: "https://blog.example.org/i.png", sensitive: true, paragraphs: ["post 4"] });
    expect(posts[2]).toMatchObject({ title: "Long read", paragraphs: ["Standfirst"] });
  });

  test("loads a profile from its server with counts, verified handle and posts", async () => {
    const { fetchImpl } = net({
      [JANE]: { body: jane({ outbox: `${JANE}/outbox`, followers: `${JANE}/followers`, following: "https://elsewhere.example.org/f" }) },
      "https://blog.example.org/.well-known/webfinger?resource=acct%3Ajane%40blog.example.org": { type: "application/jrd+json", body: { links: [{ rel: "self", type: "application/activity+json", href: JANE }] } },
      [`${JANE}/followers`]: { body: { type: "OrderedCollection", totalItems: 1234 } },
      [`${JANE}/outbox`]: { body: { type: "OrderedCollection", totalItems: 7, first: `${JANE}/outbox?page=1` } },
      [`${JANE}/outbox?page=1`]: { body: { orderedItems: [{ type: "Create", to: [PUBLIC], object: { id: "https://blog.example.org/n/1", type: "Note", attributedTo: JANE, to: [PUBLIC], content: "<p>hi</p>" } }] } },
    });
    const p = (await loadFediProfile({ actor: JANE }, 2000, fetchImpl, dns))!;
    expect(p).toMatchObject({ acct: "@jane@blog.example.org", acctVerified: true, followers: 1234, postCount: 7 });
    expect(p.following).toBeUndefined(); // another host's collection isn't trusted for this account
    expect(p.posts.map(x => x.paragraphs[0])).toEqual(["hi"]);
  });

  test("a handle whose WebFinger points elsewhere is shown but not marked verified", async () => {
    const { fetchImpl } = net({
      [JANE]: { body: jane() },
      "https://blog.example.org/.well-known/webfinger?resource=acct%3Ajane%40blog.example.org": { type: "application/jrd+json", body: { links: [{ rel: "self", type: "application/activity+json", href: "https://blog.example.org/users/impostor" }] } },
    });
    const p = (await loadFediProfile({ actor: JANE }, 2000, fetchImpl, dns))!;
    expect(p.acctVerified).toBe(false);
    expect(p.postsHidden).toBe(true);
  });

  test("falls back to the handle when the profile link isn't an actor document", async () => {
    const { fetchImpl } = net({
      "https://blog.example.org/@jane": { type: "text/html", body: "<html></html>" },
      "https://blog.example.org/.well-known/webfinger?resource=acct%3Ajane%40blog.example.org": { type: "application/jrd+json", body: { links: [{ rel: "self", type: "application/activity+json", href: JANE }] } },
      [JANE]: { body: jane() },
    });
    const p = await loadFediProfile({ actor: "https://blog.example.org/@jane", acct: "@jane@blog.example.org" }, 2000, fetchImpl, dns);
    expect(p?.actor).toBe(JANE);
  });

  test("the budget covers discovery; a slow server's profile is cached for the next open", async () => {
    const { fetchImpl } = net({ [JANE]: { body: jane(), delayMs: 150 } });
    const t0 = Date.now();
    expect(await loadFediProfile({ actor: JANE }, 40, fetchImpl, dns)).toBeNull();
    expect(Date.now() - t0).toBeLessThan(120);
    await new Promise((r) => setTimeout(r, 250));
    expect((await loadFediProfile({ actor: JANE }, 40, fetchImpl, dns))?.name).toBe("Jane Writer");
  });

  test("refuses private addresses", async () => {
    const { fetchImpl, seen } = net({});
    expect(await loadFediProfile({ actor: "https://10.0.0.5/users/x" }, 500, fetchImpl, dns)).toBeNull();
    expect(seen).toEqual([]);
  });
});

describe("Banners Bonfire doesn't federate", () => {
  // fedizen.net's actor has no `image`; its Mastodon API has the banner as `header` (seen live).
  const ID = "https://fedizen.net/pub/person/01M49WEJ63T6BS62EAA337YGTT";
  const LOOKUP = "https://fedizen.net/api/v1/accounts/lookup?acct=damon";
  const HEADER = "https://fedizen.net/files/redir/s3/data/uploads/01M49WEJ63T6BS62EAA337YGTT/banners/b.jpeg";
  test("takes the header when the account is this actor", async () => {
    const { fetchImpl } = net({ [LOOKUP]: { type: "application/json", body: { id: "01M49WEJ63T6BS62EAA337YGTT", header: HEADER } } });
    expect(await bannerFromMastodonApi({ preferredUsername: "damon" }, ID, fetchImpl, dns)).toBe(HEADER);
  });
  test("ignores another account's, and Mastodon's placeholder", async () => {
    const other = net({ [LOOKUP]: { type: "application/json", body: { id: "SOMEONEELSE", header: HEADER } } });
    expect(await bannerFromMastodonApi({ preferredUsername: "damon" }, ID, other.fetchImpl, dns)).toBeUndefined();
    const missing = net({ [LOOKUP]: { type: "application/json", body: { id: "01M49WEJ63T6BS62EAA337YGTT", header: "https://fedizen.net/headers/original/missing.png" } } });
    expect(await bannerFromMastodonApi({ preferredUsername: "damon" }, ID, missing.fetchImpl, dns)).toBeUndefined();
  });
});

describe("Servers that answer actors only to signed requests", () => {
  // Mastodon with AUTHORIZED_FETCH: the actor document is 401 without a signature; its public API still answers.
  const ACTOR = "https://m.ai6yr.org/users/ai6yr";
  const routes = (account: Record<string, unknown>) => net({
    [ACTOR]: { status: 401, body: "unauthorized" },
    "https://m.ai6yr.org/.well-known/webfinger?resource=acct%3Aai6yr%40m.ai6yr.org": { type: "application/jrd+json", body: { links: [{ rel: "self", type: "application/activity+json", href: ACTOR }] } },
    "https://m.ai6yr.org/api/v1/accounts/lookup?acct=ai6yr": { type: "application/json", body: account },
    "https://m.ai6yr.org/api/v1/accounts/109/statuses?limit=10&exclude_reblogs=true": { type: "application/json", body: [
      { id: "1", url: "https://m.ai6yr.org/@ai6yr/1", visibility: "public", content: "<p>Hello <b>there</b></p>", created_at: "2026-11-16T00:00:00Z" },
      { id: "2", url: "https://m.ai6yr.org/@ai6yr/2", visibility: "private", content: "<p>secret</p>" },
    ] },
  });
  const account = { id: "109", username: "ai6yr", acct: "ai6yr", display_name: "AI6YR Ben", uri: ACTOR, url: "https://m.ai6yr.org/@ai6yr",
    avatar: "https://m.ai6yr.org/a.png", header: "https://m.ai6yr.org/headers/original/missing.png", note: "<p>Ham radio</p>",
    fields: [{ name: "Site", value: '<a href="https://ai6yr.org">ai6yr.org</a>' }], followers_count: 1200, following_count: 300, statuses_count: 9000, locked: false, bot: false };
  test("reads the profile from the origin's public API", async () => {
    const { fetchImpl } = routes(account);
    const p = await loadFediProfile({ actor: ACTOR, acct: "ai6yr@m.ai6yr.org" }, 4000, fetchImpl, dns);
    expect(p).toMatchObject({ actor: ACTOR, acct: "@ai6yr@m.ai6yr.org", acctVerified: true, name: "AI6YR Ben", avatar: "https://m.ai6yr.org/a.png", bio: ["Ham radio"], fields: [{ name: "Site", value: "ai6yr.org" }], followers: 1200 });
    expect(p?.header).toBeUndefined();
    expect(p?.posts.map(x => x.paragraphs)).toEqual([["Hello there"]]);
  });
  test("refuses an account that isn't the one asked for", async () => {
    const { fetchImpl } = routes({ ...account, uri: "https://m.ai6yr.org/users/someoneelse", username: "someoneelse" });
    expect(await loadFediProfile({ actor: ACTOR, acct: "ai6yr@m.ai6yr.org" }, 4000, fetchImpl, dns)).toBeNull();
  });
});
