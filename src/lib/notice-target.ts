import { mastodonCollectionApi } from './collections';
import type { FediPerson, FedizenNotice, FedizenNoticeGroup } from './fedizen-feed';
import { isStatusId } from './open-post';

/**
 * Where tapping a notification goes, as Mastodon, Ivory and Phanpy open them: a notification about a post (a reply or
 * mention, a like, boost or quote of yours, a poll that ended, an edit) opens that post's conversation; one about a
 * person (a follow, a follow request, a sign-up) opens their profile, or the list of them when several are grouped;
 * one about a collection opens the collection. Kinds with nothing in Atlas to show (reports, moderation warnings,
 * severed follows) go nowhere.
 */
export type NoticeTarget =
  | { kind: 'post'; statusId: string }
  | { kind: 'profile'; person: FediPerson }
  | { kind: 'people'; people: FediPerson[] }
  | { kind: 'collection'; link: string };

/** Kinds that are about the reader's account, not a person's: the person attached isn't what to open. */
const ABOUT_ACCOUNT = new Set(['admin.report', 'severed_relationships', 'moderation_warning']);

const reachable = (p: FediPerson) => !!(p.acct || p.actor);

export function noticeTarget(n: Pick<FedizenNoticeGroup, 'type' | 'people' | 'post' | 'collection'>): NoticeTarget | null {
  if (ABOUT_ACCOUNT.has(n.type)) return null;
  if (n.post && isStatusId(n.post.id)) return { kind: 'post', statusId: n.post.id };
  if (n.collection && mastodonCollectionApi(n.collection)) return { kind: 'collection', link: n.collection };
  const people = n.people.filter(reachable);
  if (people.length === 1) return { kind: 'profile', person: people[0] };
  if (people.length > 1) return { kind: 'people', people };
  return null;
}

/** The same, for a single (ungrouped) notification. */
export function singleNoticeTarget(n: FedizenNotice): NoticeTarget | null {
  return noticeTarget({
    type: n.type,
    people: [{ name: n.author, ...(n.avatar ? { avatar: n.avatar } : {}), ...(n.acct ? { acct: n.acct } : {}), ...(n.actor ? { actor: n.actor } : {}) }],
    ...(n.statusId ? { post: { id: n.statusId, text: '' } } : {}),
  });
}

/** What the row's control says to a screen reader, after the notification itself. */
export function noticeActionLabel(t: NoticeTarget): string {
  return t.kind === 'post' ? 'Open the conversation' : t.kind === 'profile' ? 'Open their profile' : t.kind === 'people' ? 'See who' : 'Open the collection';
}
