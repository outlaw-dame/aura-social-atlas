import { createServerFn } from '@tanstack/react-start';
import { voices } from './voices';

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

/** Real profile photos for Voices to know, looked up from each writer's own server. */
export const getVoiceAvatars = createServerFn({ method: 'GET' }).handler(async () => {
  const pairs = await Promise.all(voices.map(async v => [v.id, await lookupAvatar(v.handle, v.network)] as const));
  return Object.fromEntries(pairs) as Record<string, string | null>;
});
