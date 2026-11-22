/**
 * Presentation-only projection of the connected account returned by Fedizen's
 * authenticated Mastodon-compatible verify_credentials endpoint.
 *
 * This is never derived from OIDC display metadata or the Atlas-local avatar
 * preset. The server checks the returned handle against the stored, previously
 * verified delegated-grant owner before it exposes this projection.
 */
import { isPublicHttpsUrl } from './article-author';

export type FedizenViewer = {
  handle: string;
  name: string;
  avatar: string | null;
  header: string | null;
  profileUrl: string | null;
  followers: number | null;
  following: number | null;
  posts: number | null;
};

function httpsUrl(raw: unknown): string | null {
  if (typeof raw !== 'string' || /[\s\x00-\x1f]/.test(raw) || !isPublicHttpsUrl(raw)) return null;
  return new URL(raw).toString();
}

function count(raw: unknown): number | null {
  return typeof raw === 'number' && Number.isSafeInteger(raw) && raw >= 0 && raw <= 1_000_000_000 ? raw : null;
}

function displayName(raw: unknown, fallback: string): string {
  if (typeof raw !== 'string') return fallback;
  const name = raw.trim();
  return name && name.length <= 200 && !/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(name) ? name : fallback;
}

export function parseFedizenViewer(payload: unknown): FedizenViewer | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const a = payload as Record<string, unknown>;
  if (typeof a.id !== 'string' || !a.id || a.id.length > 128) return null;
  if (typeof a.acct !== 'string') return null;
  const acct = a.acct.replace(/^@/, '').trim();
  if (!/^[a-z0-9_.-]{1,64}(?:@fedizen\.net)?$/i.test(acct)) return null;
  const localName = acct.split('@')[0];
  const handle = '@' + localName + '@fedizen.net';
  const avatar = httpsUrl(a.avatar);
  const header = httpsUrl(a.header);
  const profileUrl = httpsUrl(a.url);
  const placeholder = avatar && new URL(avatar).hostname === 'fedizen.net' &&
    new URL(avatar).pathname === '/images/avatar.png';
  return {
    handle,
    name: displayName(a.display_name, localName),
    avatar: placeholder ? null : avatar,
    header,
    profileUrl: profileUrl && new URL(profileUrl).hostname === 'fedizen.net' ? profileUrl : null,
    followers: count(a.followers_count),
    following: count(a.following_count),
    posts: count(a.statuses_count),
  };
}

/** Preserve Atlas custom avatars for local logins, never show an assigned
 * memoji as though it were the actual verified Fedizen profile picture. */
export function signedInThroughFedizen(user: {
  app_metadata?: { provider?: string; providers?: string[] };
  identities?: { provider: string }[];
} | null | undefined): boolean {
  return !!user && (user.app_metadata?.provider === 'custom:app-oidc' ||
    user.app_metadata?.providers?.includes('custom:app-oidc') === true ||
    user.identities?.some(identity => identity.provider === 'custom:app-oidc') === true);
}

/**
 * Bonfire sometimes returns its generic /images/avatar.png for a real actor.
 * Resolve only the verified account's own ActivityPub actor and require the
 * expected username and same Fedizen host before accepting an icon.
 */
export function avatarFromVerifiedFedizenActor(viewer: FedizenViewer, rawActor: unknown): string | null {
  if (!viewer.profileUrl || !rawActor || typeof rawActor !== 'object' || Array.isArray(rawActor)) return null;
  const actor = rawActor as Record<string, unknown>;
  const id = httpsUrl(actor.id);
  if (!id || new URL(id).hostname !== 'fedizen.net') return null;
  const username = actor.preferredUsername;
  if (typeof username !== 'string' || username.toLowerCase() !== viewer.handle.slice(1).split('@')[0].toLowerCase()) return null;
  const icon = Array.isArray(actor.icon) ? actor.icon[0] : actor.icon;
  const url = typeof icon === 'string' ? icon :
    icon && typeof icon === 'object' && !Array.isArray(icon) ? (icon as { url?: unknown }).url : null;
  const avatar = httpsUrl(url);
  return avatar && !(new URL(avatar).hostname === 'fedizen.net' &&
    new URL(avatar).pathname === '/images/avatar.png') ? avatar : null;
}
