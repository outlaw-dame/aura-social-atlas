import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

// Disconnect revokes Atlas's grant at Fedizen; both platforms ask first, with the same words.
const QUESTION = "Disconnect Fedizen?";
const EXPLANATION =
  "Atlas will stop reading and acting for your Fedizen account until you connect again.";

describe("Disconnect Fedizen asks before revoking", () => {
  test("desktop puts Disconnect behind a confirmation", () => {
    const source = readFileSync("src/components/social/FedizenFeed.tsx", "utf8");
    expect(source).toContain(QUESTION);
    expect(source).toContain(EXPLANATION);
    expect(source).not.toMatch(/<Button[^>]*onClick=\{\(\) => void f\.disconnect\(\)\}/);
    expect(source).toMatch(/<AlertDialogAction[^>]*onClick=\{\(\) => void f\.disconnect\(\)\}/);
  });

  test("phone keeps its confirmation", () => {
    const source = readFileSync("src/components/f7/FedizenMobile.tsx", "utf8");
    expect(source).toContain(QUESTION);
    expect(source).toContain(EXPLANATION);
  });
});
