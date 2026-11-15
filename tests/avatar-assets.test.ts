import { describe, expect, test } from "bun:test";
import { readFileSync, statSync } from "node:fs";

describe("Bundled avatar presets are web-sized AVIF with WebP fallbacks", () => {
  const src = readFileSync("src/lib/atlas-avatars.ts", "utf8");
  test("the app imports AVIF and WebP, never the 1 MB PNG masters", () => {
    expect(src).not.toMatch(/avatars\/avatar-\d\.png/);
    for (let n = 1; n <= 4; n++) {
      expect(src).toContain(`@/assets/avatars/avatar-${n}.avif`);
      expect(src).toContain(`@/assets/avatars/avatar-${n}.webp`);
    }
    expect(src).toContain("installAvifFallback()");
  });
  test("each file is a real AVIF / WebP and small", () => {
    for (let n = 1; n <= 4; n++) {
      const avif = readFileSync(`src/assets/avatars/avatar-${n}.avif`);
      const webp = readFileSync(`src/assets/avatars/avatar-${n}.webp`);
      expect(avif.subarray(4, 12).toString("latin1")).toBe("ftypavif");
      expect(webp.subarray(0, 4).toString("latin1") + webp.subarray(8, 12).toString("latin1")).toBe("RIFFWEBP");
      expect(statSync(`src/assets/avatars/avatar-${n}.avif`).size).toBeLessThan(20_000);
      expect(statSync(`src/assets/avatars/avatar-${n}.webp`).size).toBeLessThan(40_000);
    }
  });
});
