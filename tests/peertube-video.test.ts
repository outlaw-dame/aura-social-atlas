import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { clearAuthorCache, mediaFor, resolveAuthorsFor, type Lookup } from "../src/lib/article-author.server";
import { embedFor, peertubeVideoId, videoFromAttachment, videoFromObject, watchUrlFor } from "../src/lib/fedi-video";
import { isVideoChannel } from "../src/lib/fedi-profile";
import { _clearFediProfileCache, loadFediProfile } from "../src/lib/fedi-profile.server";
import { followLabels } from "../src/lib/follow-labels";
import { _clearVoiceCaches, allVoices } from "../src/lib/voices.server";

/* Shapes follow PeerTube's own models (packages/models/src/activitypub/objects/video-object.ts, common-objects.ts)
 * and its routes (/w/:id and /videos/watch/:id both answer with the Video; outboxes refer to videos by URL). */
const H = "https://tube.example.org";
const UUID = "59353f51-17a1-4dd7-9935-e74c5e4ae1e2";
const WATCH = `${H}/videos/watch/${UUID}`;
const ACCOUNT = `${H}/accounts/ann`, CHANNEL = `${H}/video-channels/ann_channel`;
const PUBLIC = "https://www.w3.org/ns/activitystreams#Public";
const video = {
  type: "Video", id: WATCH, uuid: UUID, name: "Repairing a 1980s radio", duration: "PT754S", aspectRatio: 1.7778,
  embedUrl: `${H}/videos/embed/c1V6BEBFSYW36UFfvvWbZQ`, isLiveBroadcast: false, sensitive: false, to: [PUBLIC], cc: [],
  attributedTo: [{ type: "Person", id: ACCOUNT }, { type: "Group", id: CHANNEL }],
  icon: [{ type: "Image", url: `${H}/lazy-static/thumbnails/a.jpg`, mediaType: "image/jpeg", width: 280, height: 157 }, { type: "Image", url: `${H}/lazy-static/previews/a.jpg`, mediaType: "image/jpeg", width: 850, height: 480 }],
  url: [
    { type: "Link", mediaType: "text/html", href: `${H}/w/c1V6BEBFSYW36UFfvvWbZQ` },
    { type: "Link", mediaType: "video/mp4", href: "https://media.example.net/videos/a-2160.mp4", height: 2160, width: 3840, size: 1, fps: 30, attachment: [] },
    { type: "Link", mediaType: "video/mp4", href: "https://media.example.net/videos/a-720.mp4", height: 720, width: 1280, size: 1, fps: 30, attachment: [] },
    { type: "Link", mediaType: "application/x-mpegURL", href: `${H}/static/streaming-playlists/hls/${UUID}/master.m3u8`, tag: [
      { type: "Link", mediaType: "video/mp4", href: `${H}/static/streaming-playlists/hls/${UUID}/v-1080.mp4`, height: 1080, attachment: [{ type: "PropertyValue", name: "ffprobe_codec_type", value: "video" }] },
      { type: "Link", mediaType: "audio/mp4", href: `${H}/static/streaming-playlists/hls/${UUID}/a.mp4`, height: 0, attachment: [{ type: "PropertyValue", name: "ffprobe_codec_type", value: "audio" }] },
    ] },
    { type: "Link", mediaType: "application/x-bittorrent", href: `${H}/lazy-static/torrents/a.torrent` },
  ],
};
const person = (id: string, user: string, type = "Person", extra = {}) => ({ id, type, preferredUsername: user, name: user, url: id, ...extra });

type Route = { type?: string; body: unknown };
function net(routes: Record<string, Route>) {
  const seen: string[] = [];
  const fetchImpl = async (url: string) => {
    seen.push(url);
    const r = routes[url];
    if (!r) return new Response("nope", { status: 404 });
    return new Response(JSON.stringify(r.body), { headers: { "content-type": r.type ?? "application/activity+json" } });
  };
  return { fetchImpl, seen };
}
const dns: Lookup = async () => ["93.184.216.34"];
beforeEach(() => { clearAuthorCache(); _clearFediProfileCache(); });

describe("PeerTube videos", () => {
  test("reads files best-first (up to 1080p), HLS, poster, duration, aspect and the embed", () => {
    const v = videoFromObject(video)!;
    expect(v.sources.map(s => s.src)).toEqual(["https://media.example.net/videos/a-720.mp4", "https://media.example.net/videos/a-2160.mp4"]);
    expect(v.hls).toBe(`${H}/static/streaming-playlists/hls/${UUID}/master.m3u8`);
    expect(v).toMatchObject({ url: `${H}/w/c1V6BEBFSYW36UFfvvWbZQ`, title: "Repairing a 1980s radio", poster: `${H}/lazy-static/previews/a.jpg`, duration: 754, embed: `${H}/videos/embed/c1V6BEBFSYW36UFfvvWbZQ` });
    expect(v.aspect).toBeCloseTo(16 / 9, 2);
  });

  test("split audio/video streams (PeerTube 7) are never offered as files on their own", () => {
    const hlsOnly = { ...video, url: video.url.filter(u => u.mediaType !== "video/mp4") };
    const v = videoFromObject(hlsOnly)!;
    expect(v.sources).toEqual([]);
    expect(v.hls).toContain("master.m3u8");
  });

  test("an embed is only ever PeerTube's own player on the video's own server", () => {
    expect(embedFor(WATCH, "https://evil.example.com/videos/embed/x1234567")).toBe(`${H}/videos/embed/${UUID}`);
    expect(embedFor(WATCH, `${H}/videos/embed/abc12345?autoplay=1`)).toBe(`${H}/videos/embed/abc12345`);
    expect(embedFor(WATCH, `${H}/somewhere/else`)).toBe(`${H}/videos/embed/${UUID}`);
  });

  test("recognises watch, short and embed links; an embed link resolves through its watch page", () => {
    expect(peertubeVideoId(`${H}/w/c1V6BEBFSYW36UFfvvWbZQ`)).toEqual({ host: "tube.example.org", id: "c1V6BEBFSYW36UFfvvWbZQ" });
    expect(peertubeVideoId(`${H}/w/p/playlist123`)).toBeNull();
    expect(watchUrlFor(`${H}/videos/embed/${UUID}`)).toBe(WATCH);
    expect(watchUrlFor("https://news.example.org/story")).toBe("https://news.example.org/story");
  });

  test("a video attached to a status (how Bonfire hands over a federated PeerTube video)", () => {
    expect(videoFromAttachment({ type: "video", url: "https://media.example.net/a.mp4", preview_url: "https://media.example.net/a.jpg", meta: { duration: 12.5, original: { width: 1920, height: 1080 } } }, "https://fedizen.net/post/1"))
      .toMatchObject({ url: "https://fedizen.net/post/1", sources: [{ src: "https://media.example.net/a.mp4" }], duration: 13, poster: "https://media.example.net/a.jpg" });
    expect(videoFromAttachment({ type: "video", url: "https://media.example.net/m.m3u8" }, "https://fedizen.net/p")?.hls).toBe("https://media.example.net/m.m3u8");
    expect(videoFromAttachment({ type: "image", url: "https://x.org/a.png" }, "https://fedizen.net/p")).toBeNull();
    expect(videoFromAttachment({ type: "video", url: "http://x.org/a.mp4" }, "https://fedizen.net/p")).toBeNull();
  });

  test("a PeerTube link in a post yields the video, credited to its verified channel", async () => {
    const { fetchImpl } = net({
      [`${H}/w/c1V6BEBFSYW36UFfvvWbZQ`]: { body: video },
      [ACCOUNT]: { body: person(ACCOUNT, "ann") },
      [CHANNEL]: { body: person(CHANNEL, "ann_channel", "Group", { postingRestrictedToMods: true, playlists: `${CHANNEL}/playlists` }) },
    });
    const link = `${H}/w/c1V6BEBFSYW36UFfvvWbZQ`;
    const found = await resolveAuthorsFor([link], 2000, fetchImpl, dns);
    expect(found.get(link)?.map(a => a.acct)).toEqual(["@ann@tube.example.org", "@ann_channel@tube.example.org"]);
    expect(mediaFor(link)?.video).toMatchObject({ title: "Repairing a 1980s radio", creator: { acct: "@ann_channel@tube.example.org" } });
  });

  test("a channel's profile in Atlas lists its videos even though its outbox only links to them", async () => {
    const channel = person(CHANNEL, "ann_channel", "Group", { postingRestrictedToMods: true, playlists: `${CHANNEL}/playlists`, outbox: `${CHANNEL}/outbox` });
    const { fetchImpl } = net({
      [CHANNEL]: { body: channel },
      [`${CHANNEL}/outbox`]: { body: { type: "OrderedCollection", totalItems: 1, first: `${CHANNEL}/outbox?page=1` } },
      [`${CHANNEL}/outbox?page=1`]: { body: { orderedItems: [{ type: "Announce", to: [PUBLIC], actor: CHANNEL, object: WATCH }] } },
      [WATCH]: { body: video },
    });
    const p = (await loadFediProfile({ actor: CHANNEL }, 2000, fetchImpl, dns))!;
    expect(p.kind).toBe("channel");
    expect(followLabels(p.kind, false).off).toBe("Subscribe");
    expect(p.posts[0]).toMatchObject({ title: "Repairing a 1980s radio", video: { duration: 754 } });
  });

  test("only a PeerTube-style channel counts as a video channel", () => {
    expect(isVideoChannel({ type: "Group", postingRestrictedToMods: true, playlists: "x" })).toBe(true);
    expect(isVideoChannel({ type: "Group" })).toBe(false);
    expect(isVideoChannel({ type: "Person", postingRestrictedToMods: true, playlists: "x" })).toBe(false);
  });
});

describe("Voices to know sources", () => {
  const realFetch = globalThis.fetch;
  afterEach(() => { globalThis.fetch = realFetch; _clearVoiceCaches(); });
  test("FediDB's popular accounts are sorted by their server's software; Castopod Index adds live popular shows", async () => {
    const now = Math.floor(Date.now() / 1000);
    globalThis.fetch = (async (url: string) => {
      const body = url.endsWith("/popular-accounts") ? { data: [
        { username: "big", name: "Big Account", domain: "mastodon.example", account_url: "https://mastodon.example/@big", avatar_url: "https://mastodon.example/a.png", followers_count: 120000, bio: "<p>Hi &amp; welcome</p>" },
        { username: "tube", name: "Tube Channel", domain: "tube.example.org", account_url: "https://tube.example.org/a/tube", followers_count: 9000 },
        { username: "bad", domain: "x", account_url: "javascript:alert(1)" },
      ] }
        : url.includes("/server/domain/mastodon.example") ? { software: { slug: "mastodon", name: "Mastodon" } }
        : url.includes("/server/domain/tube.example.org") ? { software: { slug: "peertube", name: "PeerTube" } }
        : url.includes("castopod") ? [
          { title: "Live Show", link: "https://pods.example.org/@live", popularityScore: 7, dead: 0, newestItemPubdate: now - 86400, description: "<p>A show</p>" },
          { title: "Old Show", link: "https://pods.example.org/@old", popularityScore: 9, dead: 0, newestItemPubdate: now - 400 * 86400 },
          { title: "Dead Show", link: "https://pods.example.org/@dead", popularityScore: 9, dead: 1, newestItemPubdate: now },
        ] : null;
      return body ? new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } }) : new Response("no", { status: 404 });
    }) as unknown as typeof fetch;
    const { voices, sources } = await allVoices();
    expect(sources).toEqual({ fedidb: true, castopodIndex: true });
    const big = voices.find(v => v.handle === "@big@mastodon.example")!;
    expect(big).toMatchObject({ category: "popular", network: "Mastodon", followers: 120000, bio: "Hi & welcome" });
    expect(voices.find(v => v.handle === "@tube@tube.example.org")).toMatchObject({ category: "video", network: "PeerTube" });
    expect(voices.find(v => v.handle === "@live@pods.example.org")).toMatchObject({ category: "podcast", network: "Castopod" });
    expect(voices.some(v => v.handle.includes("@old@") || v.handle.includes("@dead@") || v.handle.includes("bad"))).toBe(false);
    expect(voices.some(v => v.category === "writer")).toBe(true);
  });
  test("curated voices still show when FediDB and the Castopod Index are down", async () => {
    globalThis.fetch = (async () => new Response("down", { status: 503 })) as unknown as typeof fetch;
    const { voices, sources } = await allVoices();
    expect(sources).toEqual({ fedidb: false, castopodIndex: false });
    expect(new Set(voices.map(v => v.category))).toEqual(new Set(["writer", "podcast", "video"]));
  });
});
