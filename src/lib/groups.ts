/**
 * Groups on Fedizen — Bonfire Community v1.1.0-rc.1 (bonfire_classify 908479f, bonfire_ui_groups 03e24a9).
 *
 * Bonfire models a group as a Category of type "group"; a group's "topics" are child categories of type
 * "topic". Each group has four boundary dimensions, read here from `category.boundaries`:
 *   - membership: open | local:members | on_request | invite_only            (who can join)
 *   - visibility: global | nonfederated[:preview] | local:preview | …        (who can see it; ":preview" =
 *                 outsiders see that it exists, only members read its posts)
 *   - participation: anyone | local:contributors | group_members | moderators (who can post)
 *   - default_content_visibility                                            (the default audience of posts)
 * Groups federate as ActivityPub `Group` actors (FEP-1b12), so Lemmy, Mbin, Mobilizon and other Bonfire
 * groups appear alongside Fedizen's own; a post reaches a group's feed through the group's boost of it.
 *
 * Browser-safe: types and mapping only. Network reads are in groups.server.ts.
 */
import { FEDIZEN } from './fedizen-feed';
import { htmlToParagraphs } from './spotlight';

export const BONFIRE_VERSION = 'v1.1.0-rc.1';

/** A post in a group's feed, as plain text (remote HTML is never rendered). `group` names the group it was posted in. */
export type GroupPost = { id: string; paragraphs: string[]; date?: string; url: string; author: string; handle: string; avatar?: string; image?: string; group?: string };

export type JoinMode = 'open' | 'local' | 'request' | 'invite';

export type Group = {
  id: string;
  name: string;
  /** "group", or "topic" for a sub-space inside a group. */
  type: 'group' | 'topic';
  username?: string;
  /** Where the group lives: fedizen.net, or the server it is mirrored from. */
  host: string;
  /** Fedizen's web page for the group (join, post and moderate there). */
  url: string;
  summary: string[];
  avatar?: string;
  banner?: string;
  members?: number;
  parentId?: string;
  joinMode: JoinMode;
  /** Only moderators post: Bonfire's "Announcement channel". */
  announcements: boolean;
  /** Outsiders see that it exists; only members read its posts. */
  membersOnlyContent: boolean;
  /** Visible and joinable across the fediverse (not Fedizen-only). */
  federated: boolean;
  archived: boolean;
};

type Json = Record<string, unknown>;
const obj = (v: unknown): v is Json => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

/** Bonfire media can be absolute or a path on Fedizen; only https URLs are used. */
export function mediaUrl(v: unknown): string | undefined {
  const s = str(v);
  if (!s) return undefined;
  if (s.startsWith('/') && !s.startsWith('//')) return `${FEDIZEN}${s}`;
  return /^https:\/\//i.test(s) ? s : undefined;
}

const hostOf = (u?: string) => { try { return u ? new URL(u).hostname.toLowerCase() : undefined; } catch { return undefined; } };

export function joinModeOf(membership?: string): JoinMode {
  switch (membership) {
    case 'on_request': return 'request';
    case 'invite_only': return 'invite';
    case 'local:members': return 'local';
    default: return 'open';
  }
}

/** One line on how people take part, in the words Bonfire's own presets use. */
export function groupAccessLabel(g: Pick<Group, 'joinMode' | 'announcements' | 'membersOnlyContent' | 'federated'>): string {
  if (g.announcements) return 'Announcement channel';
  if (g.joinMode === 'request') return g.membersOnlyContent ? 'Private · request to join' : 'Request to join';
  if (g.joinMode === 'invite') return 'Invite only';
  if (g.joinMode === 'local') return 'Fedizen members can join';
  return g.federated ? 'Open to everyone' : 'Open';
}

/** Bonfire GraphQL `Category` → Group, or null when it isn't usable. */
export function groupFromBonfire(c: unknown): Group | null {
  if (!obj(c)) return null;
  const id = str(c.id);
  const character = obj(c.character) ? c.character : {};
  const profile = obj(c.profile) ? c.profile : {};
  const name = str(c.name) ?? str(profile.name) ?? str(character.username);
  if (!id || !/^[A-Za-z0-9_-]{1,64}$/.test(id) || !name) return null;
  const username = str(character.username)?.replace(/^[@&+]/, '');
  const canonical = str(character.canonicalUri);
  const at = username?.indexOf('@') ?? -1;
  const host = (at > 0 ? username!.slice(at + 1).toLowerCase() : undefined) ?? hostOf(canonical) ?? 'fedizen.net';
  const dims = new Map<string, string>();
  for (const b of Array.isArray(c.boundaries) ? c.boundaries : []) if (obj(b) && str(b.key) && str(b.slug)) dims.set(str(b.key)!, str(b.slug)!);
  const visibility = dims.get('visibility') ?? '';
  const type = c.type === 'topic' ? 'topic' : 'group';
  const safeUser = username && /^[A-Za-z0-9_.@-]{1,200}$/.test(username) ? username : undefined;
  return {
    id, name: name.slice(0, 120), type, username: safeUser, host,
    url: `${FEDIZEN}/${type === 'topic' ? '+' : 'group/'}${safeUser ?? id}`,
    summary: htmlToParagraphs(str(c.summary) ?? str(profile.summary) ?? '').slice(0, 6),
    avatar: mediaUrl(profile.icon), banner: mediaUrl(profile.image),
    members: typeof c.membersCount === 'number' && c.membersCount >= 0 ? c.membersCount : undefined,
    parentId: str(c.parentCategoryId),
    joinMode: joinModeOf(dims.get('membership')),
    announcements: dims.get('participation') === 'moderators',
    membersOnlyContent: /:preview$|^members/.test(visibility),
    federated: visibility === 'global' || visibility === 'public' || visibility === 'global:preview' || visibility === 'preview',
    archived: c.isDisabled === true,
  };
}

/** Groups first (biggest first), then anything else; archived and unusable entries dropped. */
export function groupsFromBonfire(edges: unknown): Group[] {
  return (Array.isArray(edges) ? edges : [])
    .map(groupFromBonfire)
    .filter((g): g is Group => !!g && !g.archived)
    .sort((a, b) => (a.type === b.type ? (b.members ?? 0) - (a.members ?? 0) : a.type === 'group' ? -1 : 1));
}

/** The group's full federated address, as Bonfire shows it: `&name@instance` (`+name@instance` for a topic). */
export const groupHandle = (g: Group) => (g.username ? `${g.type === 'topic' ? '+' : '&'}${g.username.includes('@') ? g.username : `${g.username}@${g.host}`}` : undefined);
