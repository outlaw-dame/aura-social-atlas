import { describe, expect, test } from "bun:test";
import { readFileSync, statSync } from "node:fs";
import { videoFromAttachment } from "../src/lib/fedi-video";

describe("GIFs Mastodon transcoded to video play like GIFs", () => {
  test("gifv attachments are marked gif; ordinary videos and HLS aren't", () => {
    const gif = videoFromAttachment({ type: "gifv", url: "https://files.mastodon.social/a.mp4", preview_url: "https://files.mastodon.social/a.png", meta: { original: { width: 480, height: 270 } } }, "https://mastodon.social/@a/1");
    expect(gif?.gif).toBe(true);
    expect(gif?.aspect).toBeCloseTo(480 / 270);
    expect(videoFromAttachment({ type: "video", url: "https://files.example/a.mp4" }, "https://x.example/1")?.gif).toBeUndefined();
    expect(videoFromAttachment({ type: "gifv", url: "https://files.example/a.m3u8" }, "https://x.example/1")?.gif).toBeUndefined();
  });
  test("the GIF player is inline, muted, looping, controls-free, honours Reduce Motion and plays only on screen", () => {
    const src = readFileSync("src/components/social/VideoPlayer.tsx", "utf8");
    const gif = src.slice(src.indexOf("function GifVideo"), src.indexOf("function FullVideo"));
    expect(src).toContain("if (video.gif) return <GifVideo");
    for (const attr of ["muted", "loop", "playsInline", "disablePictureInPicture"]) expect(gif).toContain(attr);
    expect(gif).not.toMatch(/\bcontrols\b|autoPlay|playVideo\(/);
    expect(gif).toContain("prefers-reduced-motion: reduce");
    expect(gif).toContain("IntersectionObserver");
    // Off-screen pausing stays on under Reduce Motion; only automatic playback is gated.
    expect(gif).not.toMatch(/if \(!el \|\| reduced\) return/);
    expect(gif).toContain("if (!e.isIntersecting) el.pause(); else if (!reduced) void el.play()");
  });
});

describe("Sample photos ship as AVIF where it pays, JPEG as fallback", () => {
  const cat = readFileSync("src/lib/social-catalogue.ts", "utf8");
  test("three photos are AVIF with their JPEG registered as fallback; the star field stays JPEG", () => {
    for (const n of ["architecture", "design", "travel"]) {
      expect(cat).toContain(`@/assets/news-${n}.avif`);
      expect(readFileSync(`src/assets/news-${n}.avif`).subarray(4, 12).toString("latin1")).toBe("ftypavif");
      expect(statSync(`src/assets/news-${n}.avif`).size).toBeLessThan(statSync(`src/assets/news-${n}.jpg`).size * 0.8);
    }
    expect(cat).toMatch(/registerImageFallbacks\(\[\[architecture, architectureJpg\], \[design, designJpg\], \[travel, travelJpg\]\]\)/);
    expect(cat).toContain("@/assets/news-space.jpg");
  });
});
