import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { bioAsText, fromBonfireProfile, isWebsite, profileInput } from "../src/lib/fedizen-profile";
import { readMyFedizenProfile, updateMyFedizenProfile } from "../src/lib/fedizen-profile.server";
import { resetRateLimitState } from "../src/lib/fedizen-rate-limit";

const realFetch = globalThis.fetch;
beforeEach(() => resetRateLimitState());
afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("what Atlas sends to Bonfire's updateUser", () => {
  const ok = { name: "Ann", bio: "Hi #openweb", website: "example.org", location: "Lisbon" };
  test("Bonfire's limits: a name is required, at most 100; a bio at most 10,240", () => {
    expect(profileInput.safeParse(ok).success).toBe(true);
    expect(profileInput.safeParse({ ...ok, name: "  " }).success).toBe(false);
    expect(profileInput.safeParse({ ...ok, name: "x".repeat(101) }).success).toBe(false);
    expect(profileInput.safeParse({ ...ok, bio: "x".repeat(10_240) }).success).toBe(true);
    expect(profileInput.safeParse({ ...ok, bio: "x".repeat(10_241) }).success).toBe(false);
  });
  test("one-line fields stay one line; no control characters; nothing extra", () => {
    expect(profileInput.safeParse({ ...ok, location: "a\nb" }).success).toBe(false);
    expect(profileInput.safeParse({ ...ok, name: "a\u0000" }).success).toBe(false);
    expect(profileInput.safeParse({ ...ok, extra: 1 }).success).toBe(false);
  });
  test("websites: http(s) with or without the scheme, or empty", () => {
    for (const w of ["example.org", "https://example.org/me", "http://blog.example.org", ""])
      expect(profileInput.safeParse({ ...ok, website: w }).success).toBe(true);
    for (const w of [
      "javascript:alert(1)",
      "localhost",
      "ftp://example.org",
      "https://user:pw@example.org",
    ])
      expect(isWebsite(w)).toBe(false);
  });
});

describe("a stored bio becomes text to edit, so saving doesn't wrap its links again", () => {
  test("HTML from Bonfire's linking", () => {
    expect(
      bioAsText(
        '<p>Hi <a href="https://fedizen.net/hashtag/openweb">#openweb</a></p><p>Second</p>',
      ),
    ).toBe("Hi #openweb\n\nSecond");
  });
  test("Markdown links and autolinks", () => {
    expect(bioAsText("Find me at [@ann](https://fedizen.net/@ann) and <https://example.org>")).toBe(
      "Find me at @ann and https://example.org",
    );
  });
  test("plain text is kept as written", () => {
    expect(bioAsText("Line one\nLine two")).toBe("Line one\nLine two");
    expect(bioAsText(null)).toBe("");
  });
  test("profile fields are read safely", () => {
    expect(
      fromBonfireProfile({ name: " Ann ", summary: null, website: null, location: "X" }),
    ).toEqual({ name: "Ann", bio: "", website: "", location: "X" });
    expect(fromBonfireProfile("nope")).toBeNull();
  });
});

const gql = (data: unknown) =>
  new Response(JSON.stringify({ data }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
const user = (id: string) => ({
  id,
  character: { username: "ann" },
  profile: { name: "Ann", summary: "<p>Hi</p>", website: "example.org", location: "Lisbon" },
});

describe("reading and saving go to the verified account's own profile", () => {
  test("read: the account's own user only", async () => {
    globalThis.fetch = mock(async () => gql({ me: { user: user("U1") } })) as typeof fetch;
    expect(await readMyFedizenProfile("t", "U1")).toEqual({
      name: "Ann",
      bio: "Hi",
      website: "example.org",
      location: "Lisbon",
    });
    expect(await readMyFedizenProfile("t", "SOMEONE-ELSE")).toBeNull();
  });

  test("save: the four profile_input fields, as one mutation, never retried", async () => {
    const bodies: { query: string; variables: unknown }[] = [];
    globalThis.fetch = mock(async (_u: RequestInfo | URL, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)));
      return gql({ updateUser: { user: user("U1") } });
    }) as typeof fetch;
    const saved = await updateMyFedizenProfile("t", "U1", {
      name: "Ann",
      bio: "Hi",
      website: "example.org",
      location: "Lisbon",
    });
    expect(saved?.name).toBe("Ann");
    expect(bodies).toHaveLength(1);
    expect(bodies[0].query).toContain("mutation AtlasUpdateMyProfile");
    expect(bodies[0].query).not.toContain("images");
    expect(bodies[0].variables).toEqual({
      profile: { name: "Ann", summary: "Hi", website: "example.org", location: "Lisbon" },
    });
  });

  test("a failed mutation isn't sent twice", async () => {
    let calls = 0;
    globalThis.fetch = mock(async () => {
      calls += 1;
      return new Response("", { status: 503 });
    }) as typeof fetch;
    await expect(
      updateMyFedizenProfile("t", "U1", { name: "Ann", bio: "", website: "", location: "" }),
    ).rejects.toMatchObject({ kind: "http" });
    expect(calls).toBe(1);
  });
});
