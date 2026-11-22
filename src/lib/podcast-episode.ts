import { isPublicHttpsUrl, type FediAuthor } from './article-author';
import { cleanText } from './fedi-profile';

/**
 * A podcast episode Atlas can play in place: read from the episode's own ActivityPub record (Castopod serves each
 * episode as a PodcastEpisode, per the Podcast Index ActivityPub draft), credited to its podcast the same way any
 * article is credited to its author.
 */
export type FediEpisode = {
  /** The episode's page (its ActivityPub id). */
  url: string;
  title: string;
  /** Episode artwork; the player falls back to the podcast's avatar. */
  image?: string;
  audio: { src: string; type?: string };
  /** Seconds, when the publisher says. */
  duration?: number;
  published?: string;
  podcast: FediAuthor;
};

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown) => (typeof v === 'string' ? v : undefined);
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : v == null ? [] : [v]);

/** A URL from a string, a Link ({href}) or an Image ({url}), or a list of them; public https only. */
function urlOf(v: unknown, mediaPrefix?: string): { href: string; type?: string } | undefined {
  for (const x of list(v)) {
    if (typeof x === 'string') { if (isPublicHttpsUrl(x)) return { href: x }; continue; }
    if (!isObj(x)) continue;
    const type = str(x.mediaType);
    if (mediaPrefix && type && !type.toLowerCase().startsWith(mediaPrefix)) continue;
    const href = str(x.href) ?? (typeof x.url === 'string' ? x.url : undefined);
    if (isPublicHttpsUrl(href)) return { href, type };
    const nested = urlOf(x.url, mediaPrefix);
    if (nested) return { href: nested.href, type: nested.type ?? type };
  }
  return undefined;
}

/** Seconds from a number (Castopod) or an xsd:duration such as "PT1H2M3S" (ActivityStreams). */
export function durationSeconds(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v) && v > 0 && v < 1e6) return Math.round(v);
  const m = typeof v === 'string' ? /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/.exec(v.trim()) : null;
  if (!m || !m.slice(1).some(Boolean)) return undefined;
  const s = (+(m[1] ?? 0)) * 86400 + (+(m[2] ?? 0)) * 3600 + (+(m[3] ?? 0)) * 60 + (+(m[4] ?? 0));
  return s > 0 && s < 1e6 ? Math.round(s) : undefined;
}

/** PodcastEpisode → playable episode, given its podcast (already verified by the caller). */
export function episodeFromObject(obj: unknown, podcast: FediAuthor): FediEpisode | null {
  if (!isObj(obj) || !list(obj.type).includes('PodcastEpisode')) return null;
  const id = str(obj.id);
  if (!isPublicHttpsUrl(id)) return null;
  const audioObj = list(obj.audio).find(isObj) ?? (isObj(obj.attachment) || Array.isArray(obj.attachment) ? list(obj.attachment).find(a => isObj(a) && list(a.type).includes('Audio')) : undefined);
  if (!isObj(audioObj)) return null;
  const src = urlOf(audioObj.url, 'audio/') ?? urlOf(audioObj.id ? [audioObj.id] : [], undefined);
  if (!src) return null;
  const title = cleanText(str(audioObj.name) ?? str(obj.name) ?? '', 200);
  if (!title) return null;
  const published = str(obj.published);
  return {
    url: id, title,
    image: urlOf(obj.image, 'image/')?.href ?? urlOf(obj.icon, 'image/')?.href,
    audio: { src: src.href, type: src.type && /^audio\/[a-z0-9.+-]{1,40}$/i.test(src.type) ? src.type : undefined },
    duration: durationSeconds(audioObj.duration ?? obj.duration),
    published: published && !Number.isNaN(Date.parse(published)) ? published : undefined,
    podcast,
  };
}

/** "1:02:03" / "4:05". */
export function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${m}:${String(r).padStart(2, '0')}`;
}
