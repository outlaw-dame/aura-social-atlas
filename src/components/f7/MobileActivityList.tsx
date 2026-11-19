import { useState } from 'react';
import { Block, Button } from 'framework7-react';
import { groupSentence, noticeLabel, type FediPerson, type FedizenPost, type FedizenNoticeGroup, type NoticeFilter, type NoticePost } from '@/lib/fedizen-feed';
import { noticeActionLabel, noticeTarget, type NoticeTarget } from '@/lib/notice-target';
import { openPost } from '@/lib/open-post';
import { openFediProfile } from '@/lib/fedi-profile';
import { openCollection } from '@/lib/collections';
import { shortAgo } from '@/lib/feed-types';
import { useActivityReadState, useHiddenByFilter, useNewActivityPill, useNotificationGroups } from '@/components/social/useNotificationGroups';
import { useFollowBack } from '@/components/social/useFollowBack';
import { useWhoReacted } from '@/components/social/useOwnPosts';
import { FilterPlaceProvider } from '@/components/social/useIntelligence';
import { Icon } from './F7Extras';
import { MobilePostCard, useMobilePostActions } from './MobilePostCard';
import { noticeIcon } from './notice-icons';

const iconFor = (type: string) => noticeIcon[type] ?? { ios: 'f7:bell_fill', md: 'material:notifications' };

const TABS: { id: NoticeFilter; label: string }[] = [
  { id: 'all', label: 'All' }, { id: 'replies', label: 'Replies' }, { id: 'follows', label: 'Follows' }, { id: 'following', label: 'People you follow' },
];
const EMPTY: Record<NoticeFilter, string> = {
  all: 'No activity yet. Replies, mentions, follows, likes and boosts on Fedizen will show up here.',
  replies: 'No replies, mentions or quotes yet.',
  follows: 'No new followers yet.',
  following: 'Nothing yet from people you follow.',
};

/**
 * Phone Activity, grouped, in Bluesky's shape: tabs (All, Replies, Follows, People you follow); replies, mentions and
 * quotes as the whole post with its actions, to answer or like in place; likes and boosts with your post's picture,
 * expanding to everyone who did it (all of them, read from the post, where Fedizen's group only names a few); Follow
 * back on new followers; unread rows tinted until the next visit, with a "New activity" pill when more arrive.
 */
export function MobileGroupedActivity({ visible, fallback }: { visible: boolean; fallback: React.ReactNode }) {
  const [filter, setFilter] = useState<NoticeFilter>('all');
  const g = useNotificationGroups(filter);
  const read = useActivityReadState(g.groups, { visible, filter });
  const pill = useNewActivityPill(g.refresh, read.restart);
  const actions = useMobilePostActions();
  if (g.unsupported && filter === 'all') return <>{fallback}</>;
  // Filters for Home apply. What one catches is left out of Activity, with no notice; Settings → Keyword filters counts it.
  return <FilterPlaceProvider place="home">
    <div className="atlas-notice-tabs" role="tablist" aria-label="Show">
      {TABS.map(t => <button key={t.id} type="button" role="tab" aria-selected={filter === t.id} className={filter === t.id ? 'is-on' : undefined} onClick={() => setFilter(t.id)}>{t.label}</button>)}
    </div>
    {pill.fresh && <div className="atlas-new-posts"><button type="button" onClick={() => { void pill.show(); document.querySelector('#tab-activity')?.scrollTo({ top: 0, behavior: 'smooth' }); }}><Icon ios="f7:arrow_up" md="material:arrow_upward" />New activity</button></div>}
    {actions.error && <Block strong inset><p role="alert" style={{ margin: 0 }}>{actions.error}</p></Block>}
    {g.loading ? <Block strong inset>Loading your activity…</Block>
      : g.error ? <Block strong inset><p role="alert" style={{ margin: 0 }}>{g.error}</p><Button small onClick={() => void g.refresh()}>Try again</Button></Block>
      : !g.groups.length ? <Block strong inset>{EMPTY[filter]}</Block>
      : <div className="atlas-notices" role="list">
        {g.groups.map(x => <MobileNotice key={x.key} g={x} unread={read.isUnread(x)} actions={actions} />)}
      </div>}
    {g.more && <Block><Button tonal round disabled={g.loadingMore} onClick={g.more}>{g.loadingMore ? 'Loading…' : 'Show older'}</Button></Block>}
    {actions.sheet}
  </FilterPlaceProvider>;
}

function MobileNotice({ g, unread, actions }: { g: FedizenNoticeGroup; unread: boolean; actions: ReturnType<typeof useMobilePostActions> }) {
  const i = iconFor(g.type);
  const cls = `atlas-notice${unread ? ' is-unread' : ''}`;
  if (g.status) return <MobileNoticePost g={g} post={g.status} unread={unread} cls={cls} actions={actions} />;
  return <MobileNoticeRow g={g} unread={unread} cls={cls} />;
}

/** A reply, mention, quote or new post: the post itself, with what it is above it. Left out when a filter catches it. */
function MobileNoticePost({ g, post, unread, cls, actions }: { g: FedizenNoticeGroup; post: FedizenPost; unread: boolean; cls: string; actions: ReturnType<typeof useMobilePostActions> }) {
  const i = iconFor(g.type);
  if (useHiddenByFilter(post)) return null;
  return <div role="listitem" className={`${cls} atlas-notice-post`}>
    <p className="atlas-notice-label"><span className={`atlas-notice-kind atlas-activity-${g.type}`}><Icon ios={i.ios} md={i.md} /></span>{noticeLabel(g)}{unread && <span className="atlas-sr">, unread</span>}</p>
    <MobilePostCard post={post} actions={actions} />
  </div>;
}

function MobileNoticeRow({ g, unread, cls }: { g: FedizenNoticeGroup; unread: boolean; cls: string }) {
  const [open, setOpen] = useState(false);
  const i = iconFor(g.type);
  const s = groupSentence(g);
  const t = noticeTarget(g);
  const label = `${s.names} ${s.rest}${unread ? ', unread' : ''}`;
  // Several people, or several posts: the row opens the list in place, as Bluesky's does.
  const expands = t?.kind === 'people' || t?.kind === 'posts' || (g.people.length > 1 && (g.type === 'favourite' || g.type === 'reblog'));
  const single = g.people.length === 1 && (g.type === 'follow' || g.type === 'follow_request') ? g.people[0] : null;
  return <div role="listitem" className={cls}>
    <RowTarget t={t} label={label} expanded={open} onToggle={t?.kind === 'people' || t?.kind === 'posts' ? () => setOpen(o => !o) : undefined} />
    <span className="atlas-notice-icon"><span className={`atlas-notice-kind atlas-activity-${g.type}`}><Icon ios={i.ios} md={i.md} /></span></span>
    <div className="atlas-notice-main">
      <div className="atlas-notice-faces">
        {g.people.slice(0, 6).map((p, k) => <Face key={k} p={p} />)}
        {(t?.kind === 'people' || t?.kind === 'posts') && <span className="atlas-notice-chev" aria-hidden="true"><Icon ios={open ? 'f7:chevron_up' : 'f7:chevron_down'} md={open ? 'material:expand_less' : 'material:expand_more'} /></span>}
        {expands && t?.kind !== 'people' && t?.kind !== 'posts' && <button type="button" className="atlas-notice-more" aria-expanded={open} onClick={() => setOpen(o => !o)} aria-label={open ? 'Hide who' : `See everyone who ${g.verb.replace(/ your post$/, ' it')}`}><Icon ios={open ? 'f7:chevron_up' : 'f7:chevron_down'} md={open ? 'material:expand_less' : 'material:expand_more'} /></button>}
      </div>
      <p className="atlas-notice-text"><b>{s.names}</b> {s.rest}<span className="atlas-notice-when"> · {shortAgo(g.date)}</span></p>
      {g.post?.text && !g.posts && <p className="atlas-notice-preview">{g.post.text}</p>}
      {g.gone && <p className="atlas-notice-preview">This post was deleted, or you can no longer see it.</p>}
      {single && <div className="atlas-notice-actions"><FollowBack p={single} back={g.type === 'follow'} /></div>}
      {open && (t?.kind === 'posts' ? <PostList posts={t.posts} /> : <PeopleList g={g} />)}
    </div>
    {g.post?.image && !g.posts && <img className="atlas-notice-thumb" src={g.post.image} alt="" width={48} height={48} loading="lazy" referrerPolicy="no-referrer" />}
  </div>;
}

/** The row's own control, covering it under the faces and buttons: a link's tap, or the list it opens. */
function RowTarget({ t, label, expanded, onToggle }: { t: NoticeTarget | null; label: string; expanded: boolean; onToggle?: () => void }) {
  if (!t) return null;
  const name = `${label}. ${expanded ? 'Hide' : noticeActionLabel(t)}`;
  if (onToggle) return <button type="button" className="atlas-notice-hit" aria-label={name} aria-expanded={expanded} onClick={onToggle} />;
  const go = () => {
    if (t.kind === 'post') openPost({ statusId: t.statusId });
    else if (t.kind === 'profile') openFediProfile({ actor: t.person.actor, acct: t.person.acct, name: t.person.name });
    else if (t.kind === 'collection') openCollection(t.link);
  };
  return <button type="button" className="atlas-notice-hit" aria-label={name} onClick={go} />;
}

function Face({ p }: { p: FediPerson }) {
  const [broken, setBroken] = useState(false);
  return p.avatar && !broken
    ? <img src={p.avatar} alt="" width={30} height={30} referrerPolicy="no-referrer" onError={() => setBroken(true)} />
    : <span className="atlas-activity-initial" aria-hidden="true">{p.name.charAt(0)}</span>;
}

function FollowBack({ p, back }: { p: FediPerson & { id?: string }; back: boolean }) {
  const f = useFollowBack(p);
  if (!f.can) return null;
  const on = f.state === 'following', asked = f.state === 'requested';
  return <>
    <Button small round fill={!on && !asked} tonal={on || asked} disabled={f.busy} onClick={f.toggle} aria-pressed={on}>{on ? 'Following' : asked ? 'Requested' : back ? 'Follow back' : 'Follow'}</Button>
    {f.error && <span role="alert" className="atlas-notice-error">{f.error}</span>}
  </>;
}

/**
 * Everyone in a group, each with their profile and Follow (back). For likes and boosts the post's own list is read
 * (Mastodon favourited_by / reblogged_by), so it's everyone, not just the few Fedizen's group names.
 */
function PeopleList({ g }: { g: FedizenNoticeGroup }) {
  const kind = g.type === 'favourite' ? 'like' : g.type === 'reblog' ? 'boost' : null;
  const w = useWhoReacted(kind && g.post && g.count > g.people.length ? g.post.id : null, kind ?? 'like');
  const people: (FediPerson & { id?: string })[] = kind && w.people.length ? w.people : g.people;
  return <ul className="atlas-notice-people">
    {people.map((p, k) => <li key={p.acct ?? p.actor ?? k}>
      <button type="button" className="atlas-notice-person" disabled={!p.acct && !p.actor} onClick={() => openFediProfile({ actor: p.actor, acct: p.acct, name: p.name })}>
        <Face p={p} /><span><b>{p.name}</b>{p.acct && <span className="atlas-notice-handle">@{p.acct}</span>}</span>
      </button>
      {'id' in p && <FollowBack p={p} back={g.type === 'follow'} />}
    </li>)}
    {w.loading && <li className="atlas-notice-handle">Loading everyone…</li>}
    {w.error && <li role="alert" className="atlas-notice-handle">{w.error}</li>}
  </ul>;
}

/** One person's likes or boosts on several of your posts: each post, to open. */
function PostList({ posts }: { posts: NoticePost[] }) {
  return <ul className="atlas-notice-people">
    {posts.map(p => <li key={p.id}>
      <button type="button" className="atlas-notice-person" onClick={() => openPost({ statusId: p.id })}>
        <span className="atlas-notice-preview">{p.text || 'A post with no text'}</span>
        {p.image && <img className="atlas-notice-thumb" src={p.image} alt="" width={40} height={40} loading="lazy" referrerPolicy="no-referrer" />}
      </button>
    </li>)}
  </ul>;
}

