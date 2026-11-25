import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import {
  accountKey,
  forgetAccountReads,
  noteRateLimited,
  resetRateLimitState,
  retryAfterMs,
  waitLeft,
} from "../src/lib/fedizen-rate-limit";
import { fedizenGet, fedizenSend } from "../src/lib/fedizen.server";
import { BonfireGraphQLError, requestBonfireGraphQL } from "../src/lib/bonfire-graphql.server";

const realFetch = globalThis.fetch;
const status = (id: string, favourited = false) => ({
  id,
  url: `https://fedizen.net/post/${id}`,
  content: "<p>hi</p>",
  created_at: "2026-11-22T10:00:00Z",
  account: { id: "01ACC", acct: "ann", display_name: "Ann" },
  favourited,
});

beforeEach(() => resetRateLimitState());
afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("Retry-After", () => {
  const now = Date.parse("2026-11-22T12:00:00Z");
  test("seconds and HTTP dates, kept within 1 s and 2 min", () => {
    expect(retryAfterMs("30", now)).toBe(30_000);
    expect(retryAfterMs("Sun, 22 Nov 2026 12:00:20 GMT", now)).toBe(20_000);
    expect(retryAfterMs("0", now)).toBe(1_000);
    expect(retryAfterMs("86400", now)).toBe(120_000);
  });
  test("missing or unreadable: 15 s", () => {
    expect(retryAfterMs(null, now)).toBe(15_000);
    expect(retryAfterMs("soon", now)).toBe(15_000);
  });
});

describe("after a 429, Atlas waits instead of asking again", () => {
  test("a refused read makes the next one wait without calling Fedizen", async () => {
    let calls = 0;
    globalThis.fetch = mock(async () => {
      calls += 1;
      return new Response("", { status: 429, headers: { "retry-after": "20" } });
    }) as typeof fetch;
    expect((await fedizenGet("token-a", "/api/v1/timelines/home?limit=20")).status).toBe(429);
    expect((await fedizenGet("token-a", "/api/v1/timelines/home?limit=20")).status).toBe(429);
    expect(calls).toBe(1);
  });

  test("another account isn't held back by one account's limit", async () => {
    noteRateLimited(await accountKey("token-a"), "20");
    expect(waitLeft(await accountKey("token-b"))).toBe(0);
  });

  test("several accounts limited within a minute: everyone waits (one shared address)", async () => {
    const now = Date.now();
    for (const t of ["t1", "t2", "t3"]) noteRateLimited(await accountKey(t), "20", now);
    expect(waitLeft(await accountKey("someone-else"), now)).toBe(20_000);
  });

  test("writes wait too", async () => {
    noteRateLimited(await accountKey("token-a"), "20");
    let calls = 0;
    globalThis.fetch = mock(async () => {
      calls += 1;
      return new Response("{}");
    }) as typeof fetch;
    expect((await fedizenSend("token-a", "POST", "/api/v1/statuses/01POST/favourite")).status).toBe(
      429,
    );
    expect(calls).toBe(0);
  });

  test("GraphQL doesn't retry a 429, and waits afterwards", async () => {
    let calls = 0;
    globalThis.fetch = mock(async () => {
      calls += 1;
      return new Response("", { status: 429 });
    }) as typeof fetch;
    const ask = () =>
      requestBonfireGraphQL({
        document: "{ me { accountId } }",
        operation: "query",
        accessToken: "token-g",
        validate: (d) => d,
        waitImpl: async () => {},
      });
    await expect(ask()).rejects.toMatchObject({ kind: "http", status: 429 });
    await expect(ask()).rejects.toBeInstanceOf(BonfireGraphQLError);
    expect(calls).toBe(1);
  });

  test("no token is kept: accounts are told apart by a hash", async () => {
    const key = await accountKey("secret-token-value");
    expect(key).toMatch(/^[0-9a-f]{32}$/);
    expect(key).not.toContain("secret");
  });
});

describe("posts read moments ago are reused, but never hide the reader's own change", () => {
  test("a second read of the same post within 30 s doesn't call Fedizen", async () => {
    let calls = 0;
    globalThis.fetch = mock(async () => {
      calls += 1;
      return new Response(JSON.stringify(status("01POST")));
    }) as typeof fetch;
    expect((await fedizenGet("token-a", "/api/v1/statuses/01POST")).status).toBe(200);
    const again = await fedizenGet("token-a", "/api/v1/statuses/01POST");
    expect(again.status).toBe(200);
    expect((again.data[0] as { id: string }).id).toBe("01POST");
    expect(calls).toBe(1);
  });

  test("each account has its own copy", async () => {
    let calls = 0;
    globalThis.fetch = mock(async () => {
      calls += 1;
      return new Response(JSON.stringify(status("01POST")));
    }) as typeof fetch;
    await fedizenGet("token-a", "/api/v1/statuses/01POST");
    await fedizenGet("token-b", "/api/v1/statuses/01POST");
    expect(calls).toBe(2);
  });

  test("after the account likes something, the post is read again", async () => {
    let liked = false;
    let reads = 0;
    globalThis.fetch = mock(async (url: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "POST") {
        liked = true;
        return new Response("{}");
      }
      reads += 1;
      return new Response(JSON.stringify(status("01POST", liked)));
    }) as typeof fetch;
    await fedizenGet("token-a", "/api/v1/statuses/01POST");
    await fedizenSend("token-a", "POST", "/api/v1/statuses/01POST/favourite");
    const after = await fedizenGet("token-a", "/api/v1/statuses/01POST");
    expect(reads).toBe(2);
    expect((after.data[0] as { favourited?: boolean }).favourited).toBe(true);
  });

  test("lists and timelines are reused for only a few seconds (micro-cache), and not after the account writes", async () => {
    let calls = 0;
    globalThis.fetch = mock(async () => {
      calls += 1;
      return new Response("[]");
    }) as typeof fetch;
    await fedizenGet("token-a", "/api/v1/timelines/home?limit=20");
    await fedizenGet("token-a", "/api/v1/timelines/home?limit=20");
    expect(calls).toBe(1);
    forgetAccountReads(await accountKey("token-a"));
    await fedizenGet("token-a", "/api/v1/timelines/home?limit=20");
    expect(calls).toBe(2);
  });
});
