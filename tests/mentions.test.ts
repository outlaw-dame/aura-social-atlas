import { describe, expect, test } from "bun:test";
import { insertMention, mentionQueryAt, mentionSegments, mentionToken, mergeSuggestions } from "../src/lib/mentions";

describe("Mentions, as iMessage does them", () => {
  test("finds the @word at the caret, and nothing inside an email or a finished word", () => {
    expect(mentionQueryAt("hi @dan", 7)).toEqual({ start: 3, query: "dan" });
    expect(mentionQueryAt("@", 1)).toEqual({ start: 0, query: "" });
    expect(mentionQueryAt("mail me@dan", 11)).toBeNull();
    expect(mentionQueryAt("hi @dan there", 13)).toBeNull();
    expect(mentionQueryAt("(@ann@mastodon.so", 17)).toEqual({ start: 1, query: "ann@mastodon.so" });
  });
  test("Fedizen's own people are written short, others in full", () => {
    expect(mentionToken("@daniella@fedizen.net")).toBe("@daniella");
    expect(mentionToken("ann@mastodon.social")).toBe("@ann@mastodon.social");
  });
  test("picking someone replaces what was typed and leaves the caret after a space", () => {
    expect(insertMention("hi @dan", 3, 7, "@daniella@fedizen.net")).toEqual({ text: "hi @daniella ", caret: 13 });
    expect(insertMention("hi @dan there", 3, 6, "@daniella@fedizen.net")).toEqual({ text: "hi @daniella there", caret: 13 });
  });
  test("only confirmed mentions are marked, as whole tokens", () => {
    expect(mentionSegments("@ann and @annie, hi", ["@ann"])).toEqual([{ text: "@ann", mention: true }, { text: " and @annie, hi", mention: false }]);
    expect(mentionSegments("plain", [])).toEqual([{ text: "plain", mention: false }]);
  });
  test("suggestions: the person replied to first, no repeats, three at most", () => {
    const local = [{ handle: "@daniella", name: "Daniella" }];
    const found = [{ handle: "@daniella", name: "Daniella" }, { handle: "@dan@x.org", name: "Dan" }, { handle: "@dana", name: "Dana" }, { handle: "@danny", name: "Danny" }];
    expect(mergeSuggestions("dan", local, found).map(p => p.handle)).toEqual(["@daniella", "@dan@x.org", "@dana"]);
    expect(mergeSuggestions("zz", local, []).length).toBe(0);
  });
});
