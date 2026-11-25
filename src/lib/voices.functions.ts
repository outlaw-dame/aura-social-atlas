import { createServerFn } from '@tanstack/react-start';
import { podcastVoices, videoVoices, voices } from './voices';

async function lookupAvatar(handle: string, network: string): Promise<string | null> {
  const m = handle.match(/^@([^@]+)@(.+)$/);
  if (!m) return null;
  const [, user, domain] = m;
  const url = network === 'Micro.blog'
    ? `https://micro.blog/posts/${encodeURIComponent(user)}`
    : `https://${domain}/api/v1/accounts/lookup?acct=${encodeURIComponent(user)}`;
  try {
    const res = await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(6000) });
    if (!res.ok) return null;
    const data = await res.json() as { avatar?: string; author?: { avatar?: string } };
    const src = network === 'Micro.blog' ? data.author?.avatar : data.avatar;
    return typeof src === 'string' && src.startsWith('https://') ? src : null;
  } catch { return null; }
}

/** PeerTube and Castopod accounts: their ActivityPub actor's icon, via WebFinger (safe fetches only). */
async function actorAvatar(handle: string): Promise<string | null> {
  const [{ webfingerActor }, { fetchActor }] = await Promise.all([import('./fedi-profile.server'), import('./article-author.server')]);
  const id = await webfingerActor(handle).catch(() => null);
  const actor = id ? await fetchActor(id).catch(() => null) : null;
  const icon = actor ? [actor.icon].flat()[0] : null;
  const url = icon && typeof icon === 'object' ? (icon as { url?: unknown }).url : icon;
  return typeof url === 'string' && url.startsWith('https://') ? url : null;
}

/** Real profile photos for Voices to know, looked up from each voice's own server: about 30 requests to other
 *  servers, so the answer is kept for a day (and one lookup shared by everyone asking meanwhile), not repeated for
 *  every browser that opens Discover. Lost when the server restarts or sleeps; browsers keep their own copy too. */
let avatarsKept: { at: number; value: Record<string, string | null> } | null = null;
let avatarsOnTheirWay: Promise<Record<string, string | null>> | null = null;
const AVATARS_FOR_MS = 24 * 3_600_000;
export const getVoiceAvatars = createServerFn({ method: 'GET' }).handler(async () => {
  if (avatarsKept && Date.now() - avatarsKept.at < AVATARS_FOR_MS) return avatarsKept.value;
  avatarsOnTheirWay ??= (async () => {
    // Kept in Supabase from earlier today, before the server last slept (lookup-cache.server.ts)?
    const { readLookups, writeLookup } = await import('./lookup-cache.server');
    const stored = (await readLookups<Record<string, string | null>>('voice-avatars', ['all'])).get('all');
    if (stored && typeof stored === 'object') { avatarsKept = { at: Date.now(), value: stored }; return stored; }
    const all = [...voices, ...podcastVoices, ...videoVoices];
    const pairs = await Promise.all(all.map(async v => [v.id, await (v.network === 'PeerTube' || v.network === 'Castopod' ? actorAvatar(v.handle) : lookupAvatar(v.handle, v.network)).catch(() => null)] as const));
    const value = Object.fromEntries(pairs) as Record<string, string | null>;
    // Keep it only when most were found: a server-side hiccup shouldn't be kept for a day.
    if (Object.values(value).filter(Boolean).length >= all.length / 2) {
      avatarsKept = { at: Date.now(), value };
      writeLookup('voice-avatars', 'all', value, AVATARS_FOR_MS);
    }
    return value;
  })().finally(() => { avatarsOnTheirWay = null; });
  return avatarsOnTheirWay;
});

/** All Voices to know: curated writers, podcasters and video channels, FediDB's popular accounts and the Castopod
 *  Index's most popular shows, each with its category. */
export const getVoices = createServerFn({ method: 'GET' }).handler(async () => {
  const { allVoices } = await import('./voices.server');
  return allVoices();
});
