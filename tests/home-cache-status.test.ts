import { describe, expect, test } from "bun:test";
import { reconcileCachedHome } from "../src/lib/bonfire-native-presentation";
import type { FedizenHome } from "../src/lib/fedizen.functions";

const cached = (over: Partial<FedizenHome> = {}): FedizenHome => ({
  connected: true,
  accountHandle: "damon",
  nativeReadEnabled: false,
  posts: [{ id: "p1", author: "A", handle: "@a", paragraphs: ["kept"], url: "https://fedizen.net/p1" }],
  notices: [],
  ...over,
});
const status = (over: Partial<{ connected: boolean; handle: string | null; nativeReadEnabled: boolean }> = {}) => ({
  connected: true,
  handle: "damon",
  nativeReadEnabled: false,
  ...over,
});

describe("Home opened from this device's copy follows the server's switch", () => {
  test("switch turned on after the copy was saved: only the flag changes", () => {
    expect(reconcileCachedHome(cached(), status({ nativeReadEnabled: true }))).toEqual({
      refetch: false,
      patch: { nativeReadEnabled: true },
    });
  });

  test("switch turned off: the flag goes off too", () => {
    expect(reconcileCachedHome(cached({ nativeReadEnabled: true }), status())).toEqual({
      refetch: false,
      patch: { nativeReadEnabled: false },
    });
  });

  test("nothing changed: no update", () => {
    expect(reconcileCachedHome(cached(), status())).toEqual({ refetch: false });
    expect(reconcileCachedHome(cached({ nativeReadEnabled: true }), status({ nativeReadEnabled: true }))).toEqual({
      refetch: false,
    });
  });

  test("an older server without the field counts as off", () => {
    expect(reconcileCachedHome(cached({ nativeReadEnabled: true }), { connected: true, handle: "damon" })).toEqual({
      refetch: false,
      patch: { nativeReadEnabled: false },
    });
  });

  test("disconnected elsewhere: Home is read again rather than showing the old account's posts", () => {
    expect(reconcileCachedHome(cached(), status({ connected: false, handle: null }))).toEqual({ refetch: true });
  });

  test("a different linked account: read again", () => {
    expect(reconcileCachedHome(cached(), status({ handle: "someone-else" }))).toEqual({ refetch: true });
  });

  test("nothing to compare yet: nothing happens", () => {
    expect(reconcileCachedHome(undefined, status())).toEqual({ refetch: false });
    expect(reconcileCachedHome(cached(), undefined)).toEqual({ refetch: false });
  });
});
