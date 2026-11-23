import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

describe("Phone: a hashtag's feed is pushed, not a sheet", () => {
  const tagFeed = readFileSync("src/components/f7/TagFeed.tsx", "utf8");
  const app = readFileSync("src/components/f7/AtlasMobileApp.tsx", "utf8");
  const css = readFileSync("src/styles.css", "utf8");

  test("the tag feed is a page with a back link and no close button or popup", () => {
    expect(tagFeed).toContain("backLink");
    expect(tagFeed).not.toMatch(/<Popup\b/);
    expect(tagFeed).not.toMatch(/xmark|popupClose|aria-label="Close"/);
  });

  test("tag routes live in the swipe-back stack view, and tabs pop to its root", () => {
    expect(app).toMatch(/<View className="atlas-stack"[^>]*iosSwipeBack mdSwipeBack/);
    expect(app).toMatch(/path: '\/tag\/:tag\/', component: TagFeedPage/);
    expect(app).toContain("onClick={popToRoot}");
    expect(app).not.toMatch(/aria-label="Close tag feed"/);
    // Rail, sidebar and Settings choose destinations too: all through showTab, which pops the stack first.
    expect(app).not.toContain("f7.tab.show(");
    expect(readFileSync("src/components/f7/navigation.ts", "utf8")).toMatch(/export function showTab[\s\S]*popToRoot\(\);[\s\S]*f7\.tab\.show/);
  });

  test("routed pages read current app state, not a closure captured when they were pushed", () => {
    expect(app).not.toMatch(/pushPage\([^)]*render:/);
  });

  test("the stack sits under the tab bar and passes touches through until something is pushed", () => {
    const rule = css.match(/\.view\.atlas-stack \{([^}]*)\}/)?.[1] ?? "";
    expect(rule).toContain("z-index: 500");
    expect(rule).toContain("pointer-events: none");
    expect(css).toMatch(/html\.atlas-stack-open \.view\.atlas-stack \{ pointer-events: auto; \}/);
  });
});
