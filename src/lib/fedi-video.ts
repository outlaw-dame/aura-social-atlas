import { isPublicHttpsUrl, normalizeHost, type FediAuthor } from './article-author';
import { cleanText } from './fedi-profile';
import { durationSeconds } from './podcast-episode';

/**
 * A video Atlas can play itself (and float in the mini player): a PeerTube Video read from its own ActivityPub
 * record, a video attached to a post, or a video podcast episode. PeerTube's embed is the fallback when it offers
 * no file Atlas can play (a live stream without HLS support in the browser, restricted files…).
 */
export type FediVideo = {
  /** The video's page (its ActivityPub id or the post). */
  url: string;
  title?: string;
  poster?: string;
  /** Progressive files, best first (mp4/webm). */
  sources: { src: string; type?: string; height?: number }[];
  /** HLS master playlist (PeerTube's streaming playlist). */
  hls?: string;
  /** PeerTube's own player, on the video's own server. */
  embed?: string;
  duration?: number;
  /** Width ÷ height, for the frame before the video loads. */
  aspect?: number;
  live?: boolean;
  /** The channel (PeerTube) or account it's from, verified by the caller. */
  creator?: FediAuthor;
};

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown) => (typeof v === 'string' ? v : undefined);
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : v == null ? [] : [v]);
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : undefined);

const PLAYABLE = /^(video\/(mp4|webm|ogg)|audio\/mp4)$/i;
const HLS = /^application\/(x-mpegurl|vnd\.apple\.mpegurl)$/i;

/** PeerTube watch/embed URLs: /w/:shortUUID, /videos/watch/:uuid, /videos/embed/:id (also /w/p/ playlists aren't videos). */
const PEERTUBE_PATH = /^\/(?:w\/(?!p\/)([A-Za-z0-9_-]{8,64})|videos\/(?:watch|embed)\/([A-Za-z0-9_-]{8,64}))\/?$/;
export function peertubeVideoId(url: string): { host: string; id: string } | null {
  if (!isPublicHttpsUrl(url)) return null;
  const u = new URL(url);
  const m = PEERTUBE_PATH.exec(u.pathname);
  return m ? { host: normalizeHost(u.hostname), id: (m[1] ?? m[2])! } : null;
}
/** An embed link resolves through its watch page, which serves the Video's ActivityPub record. */
export function watchUrlFor(url: string): string {
  const p = peertubeVideoId(url);
  return p && /\/videos\/embed\//.test(new URL(url).pathname) ? `https://${p.host}/videos/watch/${p.id}` : url;
}
/** PeerTube's player for this video, on the video's own server only. */
export function embedFor(videoId: string, embed?: string): string | undefined {
  const host = normalizeHost(new URL(videoId).hostname);
  const candidates = [embed, (() => { const p = peertubeVideoId(videoId); return p ? `https://${p.host}/videos/embed/${p.id}` : undefined; })()];
  for (const c of candidates) {
    if (!c || !isPublicHttpsUrl(c)) continue;
    const u = new URL(c);
    if (normalizeHost(u.hostname) === host && /^\/videos\/embed\/[A-Za-z0-9_-]{8,64}\/?$/.test(u.pathname)) return `https://${u.host}${u.pathname}`;
  }
  return undefined;
}

/** PeerTube Video (or any ActivityStreams Video with playable url links) → playable video. */
export function videoFromObject(obj: unknown, creator?: FediAuthor): FediVideo | null {
  if (!isObj(obj) || !list(obj.type).includes('Video')) return null;
  const id = str(obj.id);
  if (!isPublicHttpsUrl(id)) return null;
  const links = list(obj.url).filter(isObj);
  const sources: FediVideo['sources'] = [];
  let hls: string | undefined;
  const take = (l: Json) => {
    const href = str(l.href), type = str(l.mediaType) ?? '';
    if (!isPublicHttpsUrl(href)) return;
    if (HLS.test(type)) { hls ??= href; return; }
    // PeerTube 7+ can split a video's audio and picture into separate streams and marks each with
    // ffprobe_codec_type; a file carrying one of them plays silent or blank on its own, so only HLS can join them.
    const split = list(l.attachment).some(a => isObj(a) && str(a.name) === 'ffprobe_codec_type');
    if (PLAYABLE.test(type) && !split)
      sources.push({ src: href, type: type.toLowerCase(), height: num(l.height) });
  };
  for (const l of links) { take(l); if (HLS.test(str(l.mediaType) ?? '')) for (const t of list(l.tag).filter(isObj)) take(t); }
  // Best first, but no larger than 1080p for an inline player.
  sources.sort((a, b) => score(b.height) - score(a.height));
  const html = links.find(l => /^text\/html$/i.test(str(l.mediaType) ?? '') && isPublicHttpsUrl(str(l.href)));
  const icons = list(obj.icon).filter(isObj).filter(i => isPublicHttpsUrl(str(i.url)));
  const poster = icons.sort((a, b) => (num(b.width) ?? 0) - (num(a.width) ?? 0))[0];
  const embed = embedFor(id, str(obj.embedUrl));
  if (!sources.length && !hls && !embed) return null;
  const aspect = num(obj.aspectRatio) ?? (num(poster?.width) && num(poster?.height) ? num(poster!.width)! / num(poster!.height)! : undefined);
  const title = cleanText(str(obj.name) ?? '', 200) || undefined;
  return {
    url: str(html?.href) ?? id, title, poster: str(poster?.url), sources: sources.slice(0, 4), hls, embed,
    duration: durationSeconds(obj.duration), aspect: aspect && aspect > 0.2 && aspect < 5 ? aspect : undefined,
    live: obj.isLiveBroadcast === true || undefined, creator,
  };
}
const score = (h?: number) => (h == null ? 0 : h <= 1080 ? h : 1080 - (h - 1080));

/** A video attached to a Mastodon-API status (Bonfire maps a federated PeerTube Video to one). */
export function videoFromAttachment(a: { type?: string | null; url?: string | null; preview_url?: string | null; remote_url?: string | null; meta?: unknown; description?: string | null }, pageUrl: string): FediVideo | null {
  if (a.type !== 'video' && a.type !== 'gifv') return null;
  const src = isPublicHttpsUrl(a.url) ? a.url : isPublicHttpsUrl(a.remote_url) ? a.remote_url : undefined;
  if (!src) return null;
  const meta = isObj(a.meta) ? a.meta : {};
  const original = isObj(meta.original) ? meta.original : {};
  const w = num(original.width), h = num(original.height);
  const isHls = /\.m3u8(\?|$)/i.test(src);
  return {
    url: pageUrl, title: cleanText(a.description ?? '', 200) || undefined, poster: isPublicHttpsUrl(a.preview_url) ? a.preview_url : undefined,
    sources: isHls ? [] : [{ src }], hls: isHls ? src : undefined,
    duration: durationSeconds(meta.duration), aspect: w && h ? w / h : undefined,
  };
}

/** A podcast episode whose enclosure is a video (Podcasting 2.0 allows it; Castopod itself takes only mp3/m4a). */
export function episodeVideo(obj: unknown, podcast: FediAuthor): FediVideo | null {
  if (!isObj(obj) || !list(obj.type).includes('PodcastEpisode') || !isPublicHttpsUrl(str(obj.id))) return null;
  const media = [...list(obj.audio), ...list(obj.video), ...list(obj.attachment)].filter(isObj);
  for (const m of media) {
    for (const l of [m, ...list(m.url).filter(isObj)]) {
      const type = (str(l.mediaType) ?? '').toLowerCase(), href = str(l.href) ?? str(l.url);
      if (/^video\/(mp4|webm|ogg)$/.test(type) && isPublicHttpsUrl(href)) {
        const image = list(obj.image).filter(isObj).map(i => str(i.url)).find(u => isPublicHttpsUrl(u));
        return { url: str(obj.id)!, title: cleanText(str(m.name) ?? str(obj.name) ?? '', 200) || undefined, poster: image, sources: [{ src: href, type }], duration: durationSeconds(m.duration ?? obj.duration), creator: podcast };
      }
    }
  }
  return null;
}
