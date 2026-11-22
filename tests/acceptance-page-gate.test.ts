import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fedizenAcceptanceEnabled } from "../src/lib/bonfire-acceptance.server";

describe("staging acceptance page exists only where diagnostics are enabled", () => {
  test("only the exact value enables it", () => {
    expect(fedizenAcceptanceEnabled("enabled")).toBe(true);
    for (const v of [undefined, "", "true", "Enabled", "disabled", "verified"]) {
      expect(fedizenAcceptanceEnabled(v)).toBe(false);
    }
  });

  test("the route answers not found before rendering when the server says no", () => {
    const route = readFileSync("src/routes/fedizen-acceptance.tsx", "utf8");
    expect(route).toMatch(/loader:\s*async \(\) => \{\s*if \(!\(await getFedizenAcceptancePageEnabled\(\)\)\) throw notFound\(\);/);
  });
});
