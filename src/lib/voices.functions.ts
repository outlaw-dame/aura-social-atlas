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

/** Real profile photos for Voices to know, looked up from each voice's own server. */
export const getVoiceAvatars = createServerFn({ method: 'GET' }).handler(async () => {
  const all = [...voices, ...podcastVoices, ...videoVoices];
  const pairs = await Promise.all(all.map(async v => [v.id, await (v.network === 'PeerTube' || v.network === 'Castopod' ? actorAvatar(v.handle) : lookupAvatar(v.handle, v.network)).catch(() => null)] as const));
  return Object.fromEntries(pairs) as Record<string, string | null>;
});

/** All Voices to know: curated writers, podcasters and video channels, FediDB's popular accounts and the Castopod
 *  Index's most popular shows, each with its category. */
export const getVoices = createServerFn({ method: 'GET' }).handler(async () => {
  const { allVoices } = await import('./voices.server');
  return allVoices();
});
