import { beforeEach, describe, expect, test } from "bun:test";
import {
  actorMayClaim,
  isPublicHttpsUrl,
  parseArticleHead,
  parseHandle,
  actorToAuthor,
} from "../src/lib/article-author";
import {
  clearAuthorCache,
  resolveArticleAuthors,
  resolveAuthorsFor,
  safeFetch,
} from "../src/lib/article-author.server";
import { bonfireAuthor, linkAuthor } from "../src/lib/spotlight";

/* A fake network: url → response. Records every request so tests can assert nothing else was fetched. */
type Fake = { status?: number; type?: string; body?: unknown; location?: string; delayMs?: number };
function net(routes: Record<string, Fake>) {
  const seen: string[] = [];
  const fetchImpl = async (url: string, init?: RequestInit) => {
    seen.push(url);
    const r = routes[url];
    if (!r) return new Response("not found", { status: 404 });
    if (r.delayMs) await new Promise((res) => setTimeout(res, r.delayMs));
    const headers: Record<string, string> = {
      "content-type": r.type ?? "application/activity+json",
    };
    if (r.location) headers.location = r.location;
    const body =
      r.body == null ? null : typeof r.body === "string" ? r.body : JSON.stringify(r.body);
    expect(init?.redirect).toBe("manual");
    return new Response(body, { status: r.status ?? 200, headers });
  };
  return { fetchImpl, seen };
}

const article = (attributedTo: unknown, id = "https://blog.example.org/post/1") => ({
  "@context": "https://www.w3.org/ns/activitystreams",
  id,
  type: "Article",
  name: "A post",
  attributedTo,
});
const actor = (id: string, extra: Record<string, unknown> = {}) => ({
  "@context": ["https://www.w3.org/ns/activitystreams"],
  id,
  type: "Person",
  preferredUsername: "jane",
  name: "Jane Writer",
  url: id.replace("/users/", "/@"),
  icon: { type: "Image", url: "https://cdn.example.org/jane.png" },
  ...extra,
});

beforeEach(() => clearAuthorCache());

describe("ActivityPub-native articles (what Mastodon's link previews ignore)", () => {
  test("credits the attributedTo actor when the article and actor share a host", async () => {
    const { fetchImpl } = net({
      "https://blog.example.org/post/1": { body: article("https://blog.example.org/users/jane") },
      "https://blog.example.org/users/jane": { body: actor("https://blog.example.org/users/jane") },
    });
    const [a] = await resolveArticleAuthors("https://blog.example.org/post/1", fetchImpl);
    expect(a).toEqual({
      name: "Jane Writer",
      acct: "@jane@blog.example.org",
      url: "https://blog.example.org/@jane",
      avatar: "https://cdn.example.org/jane.png",
      verifiedBy: "activitypub",
    });
  });

  test("follows the page's <link rel=alternate type=application/activity+json>", async () => {
    const html = `<html><head><title>x</title><link rel="alternate" type="application/activity+json" href="/ap/post/1"></head><body>…</body></html>`;
    const { fetchImpl } = net({
      "https://blog.example.org/post/1": { type: "text/html; charset=utf-8", body: html },
      "https://blog.example.org/ap/post/1": {
        body: article("https://blog.example.org/users/jane"),
      },
      "https://blog.example.org/users/jane": { body: actor("https://blog.example.org/users/jane") },
    });
    const authors = await resolveArticleAuthors("https://blog.example.org/post/1", fetchImpl);
    expect(authors.map((a) => a.acct)).toEqual(["@jane@blog.example.org"]);
  });

  test("ignores an ActivityPub alternate link on another host", async () => {
    const html = `<head><link rel="alternate" type="application/activity+json" href="https://evil.example.net/ap"></head>`;
    const { fetchImpl, seen } = net({
      "https://blog.example.org/post/1": { type: "text/html", body: html },
    });
    expect(await resolveArticleAuthors("https://blog.example.org/post/1", fetchImpl)).toEqual([]);
    expect(seen).not.toContain("https://evil.example.net/ap");
  });

  test("refuses an actor on another host unless it lists the article's domain in attributionDomains", async () => {
    const routes = {
      "https://blog.example.org/post/1": { body: article("https://social.example.net/users/jane") },
      "https://social.example.net/users/jane": {
        body: actor("https://social.example.net/users/jane"),
      },
    };
    expect(
      await resolveArticleAuthors("https://blog.example.org/post/1", net(routes).fetchImpl),
    ).toEqual([]);
    clearAuthorCache();
    routes["https://social.example.net/users/jane"] = {
      body: actor("https://social.example.net/users/jane", { attributionDomains: ["example.org"] }),
    };
    const [a] = await resolveArticleAuthors(
      "https://blog.example.org/post/1",
      net(routes).fetchImpl,
    );
    expect(a?.acct).toBe("@jane@social.example.net");
  });

  test("credits several authors (Mastodon only ever shows one), up to three", async () => {
    const ids = ["a", "b", "c", "d"].map((u) => `https://blog.example.org/users/${u}`);
    const routes: Record<string, Fake> = {
      "https://blog.example.org/post/1": { body: article(ids) },
    };
    for (const id of ids)
      routes[id] = {
        body: actor(id, { preferredUsername: id.split("/").pop(), name: id.split("/").pop() }),
      };
    const authors = await resolveArticleAuthors(
      "https://blog.example.org/post/1",
      net(routes).fetchImpl,
    );
    expect(authors.map((a) => a.name)).toEqual(["a", "b", "c"]);
  });

  test("rejects an actor document served from a different host than its id", async () => {
    const { fetchImpl } = net({
      "https://blog.example.org/post/1": { body: article("https://blog.example.org/users/jane") },
      "https://blog.example.org/users/jane": {
        status: 302,
        location: "https://other.example.net/jane",
      },
      "https://other.example.net/jane": { body: actor("https://blog.example.org/users/jane") },
    });
    expect(await resolveArticleAuthors("https://blog.example.org/post/1", fetchImpl)).toEqual([]);
  });
});

describe("fediverse:creator (Mastodon's mechanism, same verification)", () => {
  const html = (handle: string) =>
    `<head><meta name="fediverse:creator" content="${handle}"></head>`;
  const wf = (href: string) => ({
    subject: "acct:jane@social.example.net",
    links: [{ rel: "self", type: "application/activity+json", href }],
  });
  const wfUrl =
    "https://social.example.net/.well-known/webfinger?resource=acct%3Ajane%40social.example.net";

  test("resolves the handle through WebFinger and keeps it as the shown handle", async () => {
    const { fetchImpl } = net({
      "https://blog.example.org/post/1": {
        type: "text/html",
        body: html("@jane@social.example.net"),
      },
      [wfUrl]: { type: "application/jrd+json", body: wf("https://social.example.net/users/jane") },
      "https://social.example.net/users/jane": {
        body: actor("https://social.example.net/users/jane", {
          attributionDomains: "blog.example.org",
        }),
      },
    });
    const [a] = await resolveArticleAuthors("https://blog.example.org/post/1", fetchImpl);
    expect(a).toMatchObject({ acct: "@jane@social.example.net", verifiedBy: "fediverse-creator" });
  });

  test("a page can't credit an account that hasn't allowed its domain", async () => {
    const { fetchImpl } = net({
      "https://blog.example.org/post/1": {
        type: "text/html",
        body: html("jane@social.example.net"),
      },
      [wfUrl]: { type: "application/jrd+json", body: wf("https://social.example.net/users/jane") },
      "https://social.example.net/users/jane": {
        body: actor("https://social.example.net/users/jane"),
      },
    });
    expect(await resolveArticleAuthors("https://blog.example.org/post/1", fetchImpl)).toEqual([]);
  });
});

describe("safe fetching", () => {
  test.each([
    ["http://blog.example.org/x", false],
    ["https://127.0.0.1/x", false],
    ["https://[::1]/x", false],
    ["https://localhost/x", false],
    ["https://metadata.google.internal/x", false],
    ["https://intranet/x", false],
    ["https://user:pw@blog.example.org/x", false],
    ["https://blog.example.org:8443/x", false],
    ["https://blog.example.org/x", true],
  ])("isPublicHttpsUrl(%s) = %p", (url, ok) => {
    expect(isPublicHttpsUrl(url)).toBe(ok);
  });

  test("re-validates every redirect hop", async () => {
    const { fetchImpl, seen } = net({
      "https://blog.example.org/post/1": {
        status: 301,
        location: "http://169.254.169.254/latest/meta-data",
      },
    });
    expect(await safeFetch("https://blog.example.org/post/1", "text/html", fetchImpl)).toBeNull();
    expect(seen).toEqual(["https://blog.example.org/post/1"]);
  });

  test("gives up after three redirects", async () => {
    const routes: Record<string, Fake> = {};
    for (let i = 0; i < 5; i++)
      routes[`https://blog.example.org/${i}`] = {
        status: 302,
        location: `https://blog.example.org/${i + 1}`,
      };
    expect(
      await safeFetch("https://blog.example.org/0", "text/html", net(routes).fetchImpl),
    ).toBeNull();
  });

  test("a slow site can't hold Spotlight past its time budget", async () => {
    const { fetchImpl } = net({
      "https://slow.example.org/a": { type: "text/html", body: "<head></head>", delayMs: 400 },
    });
    const t0 = Date.now();
    const out = await resolveAuthorsFor(["https://slow.example.org/a"], 100, fetchImpl);
    expect(Date.now() - t0).toBeLessThan(350);
    expect(out.get("https://slow.example.org/a")).toBeUndefined();
  });
});

describe("parsing", () => {
  test("handles: accepts @user@host and acct:, rejects junk", () => {
    expect(parseHandle("@Jane@Social.Example.net")).toBe("Jane@social.example.net");
    expect(parseHandle("acct:jane@social.example.net")).toBe("jane@social.example.net");
    expect(parseHandle("https://social.example.net/@jane")).toBeNull();
    expect(parseHandle("jane")).toBeNull();
  });

  test("reads property= as well as name=, ignores the body", () => {
    const head = parseArticleHead(
      `<head><meta property="fediverse:creator" content="@a@x.example.org"><meta name="fediverse:creator" content="b@y.example.org"></head><body><meta name="fediverse:creator" content="c@z.example.org"></body>`,
      "https://blog.example.org/p",
    );
    expect(head.creators).toEqual(["a@x.example.org", "b@y.example.org"]);
  });

  test("strips control and bidi-override characters from display names", () => {
    const a = actorToAuthor(
      actor("https://blog.example.org/users/jane", { name: "Ja‮ne\u0000 W" }),
      "activitypub",
    );
    expect(a?.name).toBe("Jane W");
  });

  test("attributionDomains covers subdomains, not lookalikes", () => {
    const act = actor("https://social.example.net/users/jane", {
      attributionDomains: ["example.org"],
    });
    expect(actorMayClaim(act, "https://blog.example.org/p")).toBe(true);
    expect(actorMayClaim(act, "https://evilexample.org/p")).toBe(false);
  });
});

describe("Spotlight mapping", () => {
  test("keeps every Mastodon-credited author, not just the first", () => {
    const r = linkAuthor({
      authors: [
        {
          name: "A",
          account: { display_name: "A", acct: "a@x.example", url: "https://x.example/@a" },
        },
        { name: "B", account: { display_name: "B", acct: "b", url: "https://mastodon.social/@b" } },
      ],
    });
    expect(r.authorAccounts?.map((a) => a.acct)).toEqual(["@a@x.example", "@b@mastodon.social"]);
    expect(r.authorAccount?.verifiedBy).toBe("mastodon");
  });

  test("Fedizen articles link to their author's account", () => {
    expect(
      bonfireAuthor({
        author: "Ann",
        handle: "@ann",
        avatar: undefined,
        authorUrl: "https://fedizen.net/@ann",
      }),
    ).toEqual({
      name: "Ann",
      acct: "@ann@fedizen.net",
      url: "https://fedizen.net/@ann",
      avatar: undefined,
      verifiedBy: "fedizen",
    });
    expect(bonfireAuthor({ author: "Ann", handle: "@ann", avatar: undefined })).toBeUndefined();
  });
});
