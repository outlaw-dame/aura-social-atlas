import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
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

describe("videos Fedizen couldn't type (Loops)", () => {
  // Shaped like a Loops file address (loopsusercontent.com); the paths are invented.
  test('an "unknown" attachment whose file is a video plays as one', () => {
    const v = videoFromAttachment({ type: 'unknown', url: 'https://loopsusercontent.com/videos/1/2/abc.720p.mp4', preview_url: '' }, 'https://loops.example/v/2');
    expect(v?.sources).toEqual([{ src: 'https://loopsusercontent.com/videos/1/2/abc.720p.mp4' }]);
    expect(v?.gif).toBeUndefined();
    expect(videoFromAttachment({ type: 'unknown', url: '', remote_url: 'https://loopsusercontent.com/a.webm' }, 'https://x.example/1')?.sources[0]?.src).toBe('https://loopsusercontent.com/a.webm');
    expect(videoFromAttachment({ url: 'https://loopsusercontent.com/live/index.m3u8' }, 'https://x.example/1')?.hls).toBe('https://loopsusercontent.com/live/index.m3u8');
  });
  test('anything else unknown stays out: a page, an image, a name that only mentions mp4', () => {
    expect(videoFromAttachment({ type: 'unknown', url: 'https://loopsusercontent.com/file.pdf' }, 'https://x.example/1')).toBeNull();
    expect(videoFromAttachment({ type: 'unknown', url: 'https://loopsusercontent.com/mp4/photo.jpg' }, 'https://x.example/1')).toBeNull();
    expect(videoFromAttachment({ type: 'unknown', url: 'https://loopsusercontent.com/a?f=x.mp4' }, 'https://x.example/1')).toBeNull();
    expect(videoFromAttachment({ type: 'image', url: 'https://loopsusercontent.com/a.mp4' }, 'https://x.example/1')).toBeNull();
  });
});
