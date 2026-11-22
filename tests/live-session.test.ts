import { beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  CONFIRMED_FOR_MS,
  confirmLiveSession,
  forgetConfirmedSessions,
} from "../src/integrations/supabase/live-session.server";

type Answer = { data: { user: { id: string } | null }; error: unknown } | Error;

function authAnswering(...answers: Answer[]) {
  let calls = 0;
  return {
    get calls() {
      return calls;
    },
    auth: {
      async getUser() {
        const next = answers[Math.min(calls, answers.length - 1)];
        calls += 1;
        if (next instanceof Error) throw next;
        return next;
      },
    },
  };
}

const live = (id: string): Answer => ({ data: { user: { id } }, error: null });
const ended: Answer = { data: { user: null }, error: { status: 403, code: "session_not_found" } };
const now = 1_800_000_000_000;
const claims = { sub: "user-a", session_id: "session-1", exp: now / 1000 + 3600 };

describe("signed-out sessions are refused on private routes", () => {
  beforeEach(() => forgetConfirmedSessions());

  test("a live session passes", async () => {
    expect(await confirmLiveSession(authAnswering(live("user-a")), "jwt", claims, now)).toBe(true);
  });

  test("a session Supabase Auth no longer knows is refused", async () => {
    expect(await confirmLiveSession(authAnswering(ended), "jwt", claims, now)).toBe(false);
  });

  test("an Auth outage refuses rather than trusting the signature alone", async () => {
    expect(
      await confirmLiveSession(authAnswering(new Error("fetch failed")), "jwt", claims, now),
    ).toBe(false);
  });

  test("a token whose user differs from the session user is refused", async () => {
    expect(await confirmLiveSession(authAnswering(live("user-b")), "jwt", claims, now)).toBe(false);
  });

  test("missing subject is refused without asking Auth", async () => {
    const auth = authAnswering(live("user-a"));
    expect(await confirmLiveSession(auth, "jwt", { session_id: "session-1" }, now)).toBe(false);
    expect(auth.calls).toBe(0);
  });

  test("a burst of calls costs one Auth round trip, and sign-out takes effect once the window passes", async () => {
    const auth = authAnswering(live("user-a"), ended);
    for (let i = 0; i < 12; i += 1)
      expect(await confirmLiveSession(auth, "jwt", claims, now + i)).toBe(true);
    expect(auth.calls).toBe(1);
    expect(await confirmLiveSession(auth, "jwt", claims, now + CONFIRMED_FOR_MS + 1)).toBe(false);
    expect(auth.calls).toBe(2);
  });

  test("a page's simultaneous reads share one Auth round trip", async () => {
    const auth = authAnswering(live("user-a"));
    const results = await Promise.all(
      Array.from({ length: 12 }, () => confirmLiveSession(auth, "jwt", claims, now)),
    );
    expect(results.every(Boolean)).toBe(true);
    expect(auth.calls).toBe(1);
  });

  test("simultaneous reads of a signed-out session are all refused", async () => {
    const auth = authAnswering(ended);
    const results = await Promise.all(
      Array.from({ length: 5 }, () => confirmLiveSession(auth, "jwt", claims, now)),
    );
    expect(results.some(Boolean)).toBe(false);
    expect(auth.calls).toBe(1);
  });

  test("a refusal is never remembered", async () => {
    const auth = authAnswering(ended, live("user-a"));
    expect(await confirmLiveSession(auth, "jwt", claims, now)).toBe(false);
    expect(await confirmLiveSession(auth, "jwt", claims, now + 1)).toBe(true);
    expect(auth.calls).toBe(2);
  });

  test("the remembered window never outlives the token", async () => {
    const auth = authAnswering(live("user-a"), ended);
    const shortLived = { ...claims, exp: (now + 2_000) / 1000 };
    expect(await confirmLiveSession(auth, "jwt", shortLived, now)).toBe(true);
    expect(await confirmLiveSession(auth, "jwt", shortLived, now + 2_001)).toBe(false);
  });

  test("tokens without a session id are checked every time", async () => {
    const auth = authAnswering(live("user-a"));
    const noSession = { sub: "user-a", exp: claims.exp };
    await confirmLiveSession(auth, "jwt", noSession, now);
    await confirmLiveSession(auth, "jwt", noSession, now + 1);
    expect(auth.calls).toBe(2);
  });

  test("both server entry points keep the live-session check (auth-middleware.ts is generated and may be rewritten)", () => {
    for (const file of [
      "src/integrations/supabase/auth-middleware.ts",
      "src/lib/intelligence/session.server.ts",
    ]) {
      const source = readFileSync(file, "utf8");
      expect(source).toContain("getClaims(token)");
      expect(source).toContain("confirmLiveSession(supabase, token, data.claims)");
    }
  });
});
