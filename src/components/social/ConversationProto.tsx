import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useQueries, useQuery } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { BellOff, Bell, CornerDownRight, MessageSquareReply } from 'lucide-react';
import type { FedizenPost } from '@/lib/fedizen-feed';
import { fullAcct } from '@/lib/fedizen-feed';
import { shortAgo } from '@/lib/feed-types';
import { buildThread, type Thread } from '@/lib/thread';
import { allPosts, chatItems, latestTime, participantsOf, readMarks, rootOf, subjectOf, unreadIn, writeMark, type ProtoStyle, type ReplyMode } from '@/lib/conversation';
import { getFedizenStatus, getFedizenThread } from '@/lib/fedizen.functions';
import { useSaveToggle } from './useFedizenLibrary';
import { useReactions } from './usePostActions';
import { PostActionBar } from './PostActionBar';
import { PostBody } from './PostBody';
import { BoostedBy } from './PostPeople';
import { useAtlasAuth } from './AuthState';
import { useNotificationGroups } from './useNotificationGroups';

/**
 * Prototypes for comparing two ways to read a conversation (src/lib/conversation.ts has the model and sources):
 * A, Bonfire + Phanpy; B, Bonfire + Phanpy + Wavelength. Shared by desktop (ThreadView.tsx, /conversations) and the
 * phone (f7/Thread.tsx, f7/Conversations.tsx), so both compare the same thing.
 */

/* ── Choosing a prototype ───────────────────────────────────────────────────────────────────────────── */

function stored<T extends string>(k: string, ok: readonly T[], fallback: T): T {
  try { const v = localStorage.getItem(k) as T | null; return v && ok.includes(v) ? v : fallback; } catch { return fallback; }
}
function useStored<T extends string>(k: string, ok: readonly T[], fallback: T): [T, (v: T) => void] {
  const [v, setV] = useState<T>(() => stored(k, ok, fallback));
  return [v, (n: T) => { setV(n); try { localStorage.setItem(k, n); } catch { /* per-device only */ } }];
}
export const useProtoStyle = () => useStored<ProtoStyle>('atlas.proto.style', ['a', 'b'], 'a');
export const useReplyMode = () => useStored<ReplyMode>('atlas.proto.replyMode', ['nested', 'flat'], 'nested');

const STYLES: { id: ProtoStyle; label: string; note: string }[] = [
  { id: 'a', label: 'A · Bonfire + Phanpy', note: 'A thread: the post in the middle, replies nested or flat, as Bonfire and Phanpy read one.' },
  { id: 'b', label: 'B · + Wavelength', note: 'A conversation: one subject, its messages in order, a New line where you left off, mute per conversation.' },
];

/** A labelled choice between the two prototypes, above the conversation. */
export function ProtoSwitch({ style, setStyle }: { style: ProtoStyle; setStyle: (s: ProtoStyle) => void }) {
  return <div className="atlas-proto">
    <div role="radiogroup" aria-label="Conversation prototype" className="atlas-proto-switch">
      {STYLES.map(s => <button key={s.id} type="button" role="radio" aria-checked={style === s.id} onClick={() => setStyle(s.id)} className={style === s.id ? 'is-on' : undefined}>{s.label}</button>)}
    </div>
    <p className="atlas-proto-note">Prototype. {STYLES.find(s => s.id === style)!.note}</p>
  </div>;
}

/** A: Bonfire's reading modes for the replies, nested or flat. */
export function ReplyModeSwitch({ mode, setMode }: { mode: ReplyMode; setMode: (m: ReplyMode) => void }) {
  return <div role="radiogroup" aria-label="Show replies" className="atlas-proto-switch atlas-proto-small">
    {(['nested', 'flat'] as const).map(m => <button key={m} type="button" role="radio" aria-checked={mode === m} onClick={() => setMode(m)} className={mode === m ? 'is-on' : undefined}>{m === 'nested' ? 'Nested' : 'Flat'}</button>)}
  </div>;
}

/* ── Shared pieces ──────────────────────────────────────────────────────────────────────────────────── */

export function Face({ post: p, size = 28 }: { post: FedizenPost; size?: number }) {
  const [broken, setBroken] = useState(false);
  return p.avatar && !broken
    ? <img className="atlas-conv-face" src={p.avatar} alt="" width={size} height={size} style={{ width: size, height: size }} loading="lazy" referrerPolicy="no-referrer" onError={() => setBroken(true)} />
    : <span className="atlas-conv-face" aria-hidden="true" style={{ width: size, height: size, fontSize: size * 0.45 }}>{p.author.charAt(0)}</span>;
}

/** A: who's in the thread (Bonfire's participants), most active first. */
export function ParticipantsStrip({ thread }: { thread: Thread }) {
  const people = participantsOf(allPosts(thread));
  if (people.length < 2) return null;
  const shown = people.slice(0, 8);
  return <div className="atlas-conv-people" aria-label={`${people.length} people in this conversation`}>
    <span className="atlas-conv-faces" aria-hidden="true">{shown.map(x => <Face key={x.post.handle} post={x.post} size={24} />)}</span>
    <span>{people.length} people: {shown.slice(0, 3).map(x => x.post.author).join(', ')}{people.length > 3 ? ` and ${people.length - 3} more` : ''}</span>
  </div>;
}

/** The reader's own handle, to tell their messages apart. */
export function useIsMePost() {
  const { user } = useAtlasAuth();
  const statusFn = useServerFn(getFedizenStatus);
  const status = useQuery({ queryKey: ['fedizen-status', user?.id], queryFn: () => statusFn(), enabled: !!user, staleTime: 60_000 });
  const me = fullAcct(status.data?.handle)?.toLowerCase();
  return (p: FedizenPost) => !!me && fullAcct(p.acct ?? p.handle)?.toLowerCase() === me;
}

type Acts = { save: ReturnType<typeof useSaveToggle>; reactions: ReturnType<typeof useReactions>; onReply: (p: FedizenPost) => void };

/* ── B: the conversation ────────────────────────────────────────────────────────────────────────────── */

/**
 * B: Wavelength's conversation over Bonfire's thread. A subject and the people in it; messages oldest first with
 * day separators; a "New" line where you left off last time (and a button to jump there); a mute that quiets the
 * conversation in the Conversations list; replies that don't answer the message above say which one they answer.
 * Each message keeps Atlas's actions (shown on hover or tap); "Reply" at the bottom answers the opened post.
 */
export function ChatConversation({ thread: t, actions, onOpenInbox, onOpenPost, loaded }: {
  thread: Thread; actions: Acts; onOpenInbox: () => void; onOpenPost: (p: FedizenPost) => void;
  /** Fedizen has answered: only then is the conversation marked read. */ loaded: boolean;
}) {
  const isMe = useIsMePost();
  const posts = useMemo(() => allPosts(t), [t]);
  const root = rootOf(t);
  const rootKey = root.statusId ?? root.id;
  const subject = subjectOf(root);
  // Where you left off before this visit: kept for the "New" line while you read.
  const before = useRef<number | undefined>(undefined);
  const [mark, setMark] = useState(() => readMarks()[rootKey]);
  if (before.current === undefined && mark?.lastRead !== undefined) before.current = mark.lastRead;
  useEffect(() => {
    if (!loaded) return;
    const latest = latestTime(posts);
    setMark(writeMark(rootKey, { lastRead: Math.max(latest, mark?.lastRead ?? 0), seenAt: Date.now(), opened: t.focus.statusId ?? t.focus.id, subject })[rootKey]);
  }, [loaded, rootKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const items = useMemo(() => chatItems(posts, t.focus.statusId ?? t.focus.id, before.current), [posts, t.focus]);
  const people = participantsOf(posts);
  const fresh = before.current === undefined ? 0 : unreadIn(posts, before.current, isMe);
  const muted = !!mark?.muted;
  const toggleMute = () => setMark(writeMark(rootKey, { muted: !muted })[rootKey]);
  const [active, setActive] = useState<string | null>(null);
  const jump = () => document.getElementById('atlas-conv-new')?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });

  return <section className="atlas-conv" aria-label={`Conversation: ${subject}`}>
    <header className="atlas-conv-head">
      <h2 className="atlas-conv-subject">{subject}</h2>
      <div className="atlas-conv-meta">
        <span className="atlas-conv-faces" aria-hidden="true">{people.slice(0, 5).map(x => <Face key={x.post.handle} post={x.post} size={22} />)}</span>
        <span>{posts.length === 1 ? '1 message' : `${posts.length} messages`} · {people.length === 1 ? '1 person' : `${people.length} people`}</span>
      </div>
      <div className="atlas-conv-tools">
        <button type="button" onClick={toggleMute} aria-pressed={muted}>{muted ? <BellOff aria-hidden="true" /> : <Bell aria-hidden="true" />}{muted ? 'Muted' : 'Mute'}</button>
        <button type="button" onClick={onOpenInbox}>All conversations</button>
      </div>
      {fresh > 0 && <button type="button" className="atlas-conv-jump" onClick={jump}>{fresh === 1 ? '1 new message' : `${fresh} new messages`} — jump to it</button>}
    </header>
    <ol className="atlas-conv-list">
      {items.map(it => it.t === 'day'
        ? <li key={it.key} className="atlas-conv-day" role="separator"><span>{it.label}</span></li>
        : it.t === 'new'
        ? <li key={it.key} id="atlas-conv-new" className="atlas-conv-new" role="separator"><span>New</span></li>
        : <Message key={it.key} item={it} actions={actions} mine={isMe(it.post)} active={active === it.key} onActivate={() => setActive(a => (a === it.key ? null : it.key))} onOpenPost={onOpenPost} />)}
    </ol>
    <div className="atlas-conv-dock">
      <button type="button" className="atlas-conv-reply" onClick={() => actions.onReply(t.focus)} disabled={!actions.reactions.canAct}>
        <MessageSquareReply aria-hidden="true" />{actions.reactions.canAct ? `Reply to ${t.focus.author}` : 'Connect Fedizen to reply'}
      </button>
    </div>
  </section>;
}

function Message({ item, actions, mine, active, onActivate, onOpenPost }: { item: Extract<ReturnType<typeof chatItems>[number], { t: 'msg' }>; actions: Acts; mine: boolean; active: boolean; onActivate: () => void; onOpenPost: (p: FedizenPost) => void }) {
  const p = item.post;
  const time = p.date ? new Date(p.date) : null;
  return <li className={['atlas-conv-msg', item.first && 'is-first', mine && 'is-mine', item.focus && 'is-focus', active && 'is-active'].filter(Boolean).join(' ')}>
    <div className="atlas-conv-gutter">{item.first && <Face post={p} size={32} />}</div>
    <div className="atlas-conv-main" onClick={e => { const t = e.target as Element; if (!t.closest('a, button, summary, video, audio, input, label')) onActivate(); }}>
      {item.first && <p className="atlas-conv-who"><b>{p.author}</b> <span>{p.handle}</span>{time && <time dateTime={p.date} title={time.toLocaleString()}>{time.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}</time>}{p.editedAt && <span> · Edited</span>}</p>}
      {item.parent && <button type="button" className="atlas-conv-parent" onClick={() => document.getElementById(`atlas-msg-${item.parent!.statusId ?? item.parent!.id}`)?.scrollIntoView({ block: 'center' })}>
        <CornerDownRight aria-hidden="true" /><span>Replying to <b>{item.parent.author}</b>: {(item.parent.paragraphs[0] ?? '').slice(0, 80)}</span>
      </button>}
      <div id={`atlas-msg-${p.statusId ?? p.id}`} className="atlas-conv-body">
        <BoostedBy post={p} className="atlas-post-boosted" />
        {p.cw ? <details><summary>{p.cw}</summary><PostBody post={p} onTag={() => {}} /></details> : <PostBody post={p} onTag={() => {}} />}
        {p.image && !p.cw && <img src={p.image} alt={p.alt?.[0] ?? ''} loading="lazy" referrerPolicy="no-referrer" className="atlas-conv-image" />}
      </div>
      <div className="atlas-conv-actions">
        <PostActionBar post={p} save={actions.save} reactions={actions.reactions} onReply={actions.onReply}
          more={!item.focus && p.statusId ? <button type="button" className="atlas-conv-open" onClick={() => onOpenPost(p)}>Open</button> : undefined} />
      </div>
    </div>
  </li>;
}

/* ── B: the Conversations list (Wavelength's inbox of threads) ──────────────────────────────────────── */

/**
 * The conversations you're in: ones you've opened here, and ones you were mentioned in (Activity → Mentions). Each
 * is read from Fedizen (its context) and shown as Wavelength showed a thread: subject in bold, an unread dot, who
 * started it, the latest message, how many messages and how many new, and when; muted ones dimmed; newest activity
 * first, with day separators.
 */
export function useConversationIds(limit = 12): string[] {
  const { user } = useAtlasAuth();
  const mentions = useNotificationGroups(true, !!user);
  const opened = Object.values(readMarks()).sort((a, b) => (b.seenAt ?? 0) - (a.seenAt ?? 0)).map(m => m.opened).filter((x): x is string => !!x);
  const mentioned = (mentions.groups ?? []).map(g => g.post?.id).filter((x): x is string => !!x);
  return [...new Set([...opened, ...mentioned])].slice(0, limit);
}

export function ConversationsList({ onOpen }: { onOpen: (statusId: string) => void }) {
  const { user } = useAtlasAuth();
  const ids = useConversationIds();
  const read = useServerFn(getFedizenThread);
  const isMe = useIsMePost();
  const results = useQueries({ queries: ids.map(statusId => ({
    queryKey: ['fedizen-thread', user?.id, statusId],
    queryFn: () => read({ data: { expectedAtlasUserId: user!.id, statusId } }),
    enabled: !!user, staleTime: 60_000,
  })) });
  if (!user) return <p className="atlas-conv-empty">Sign in to Atlas and connect Fedizen to see your conversations.</p>;
  if (!ids.length) return <p className="atlas-conv-empty">Conversations you open, and ones you’re mentioned in, will be listed here.</p>;
  const marks = readMarks();
  const entries = dedupe(results.flatMap((r, i) => (r.data?.post ? [entryOf(ids[i], r.data.post, r.data.ancestors, r.data.descendants, marks, isMe)] : []))).sort((a, b) => b.latest - a.latest);
  const pending = results.filter(r => r.isLoading).length;
  const now = Date.now();
  let day = '';
  const out: ReactNode[] = [];
  for (const e of entries) {
    const d = dayOf(e.latest, now);
    if (d !== day) { out.push(<li key={`d-${d}`} className="atlas-conv-day" role="separator"><span>{d}</span></li>); day = d; }
    out.push(<li key={e.rootKey}><InboxRow e={e} onOpen={onOpen} /></li>);
  }
  return <>
    <ol className="atlas-inbox">{out}</ol>
    {pending > 0 && <p className="atlas-conv-empty" aria-live="polite">Loading {pending === 1 ? 'one more conversation' : `${pending} more conversations`}…</p>}
  </>;
}

type InboxEntry = { rootKey: string; open: string; root: FedizenPost; latestPost: FedizenPost; latest: number; count: number; fresh: number; muted: boolean; people: FedizenPost[]; subject: string };

function entryOf(statusId: string, post: FedizenPost, ancestors: FedizenPost[], descendants: FedizenPost[], marks: ReturnType<typeof readMarks>, isMe: (p: FedizenPost) => boolean): InboxEntry {
  const t = buildThread(post, ancestors, descendants);
  const posts = allPosts(t);
  const root = rootOf(t);
  const rootKey = root.statusId ?? root.id;
  const mark = marks[rootKey];
  return {
    rootKey, open: mark?.opened ?? statusId, root, latestPost: posts[posts.length - 1] ?? root, latest: latestTime(posts), count: posts.length,
    // Never opened here: everything others wrote counts as new, as a Wavelength thread you hadn't seen.
    fresh: unreadIn(posts, mark?.lastRead ?? 0, isMe), muted: !!mark?.muted,
    people: participantsOf(posts).map(x => x.post), subject: subjectOf(root),
  };
}

function dedupe(list: InboxEntry[]): InboxEntry[] {
  const seen = new Set<string>();
  return list.filter(e => (seen.has(e.rootKey) ? false : (seen.add(e.rootKey), true)));
}

function dayOf(ms: number, now: number): string {
  const d = new Date(ms), today = new Date(now);
  const start = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((start(today) - start(d)) / 86_400_000);
  return diff === 0 ? 'Today' : diff === 1 ? 'Yesterday' : d.toLocaleDateString(undefined, { month: 'long', day: 'numeric' });
}

function InboxRow({ e, onOpen }: { e: InboxEntry; onOpen: (statusId: string) => void }) {
  const unread = e.fresh > 0 && !e.muted;
  const preview = (e.latestPost.paragraphs[0] ?? e.latestPost.linkTitle ?? '').trim();
  return <button type="button" className={['atlas-inbox-row', unread && 'is-unread', e.muted && 'is-muted'].filter(Boolean).join(' ')} onClick={() => onOpen(e.open)}
    aria-label={`${e.subject}. Started by ${e.root.author}. ${e.count} messages${unread ? `, ${e.fresh} new` : ''}${e.muted ? ', muted' : ''}.`}>
    <span className="atlas-inbox-dot" aria-hidden="true" />
    <Face post={e.root} size={40} />
    <span className="atlas-inbox-text">
      <span className="atlas-inbox-top"><b className="atlas-inbox-subject">{e.subject}</b><time>{shortAgo(new Date(e.latest).toISOString())}</time></span>
      <span className="atlas-inbox-by">{e.root.author}{e.people.length > 1 ? ` and ${e.people.length - 1} ${e.people.length === 2 ? 'other' : 'others'}` : ''}{e.muted && <> · <BellOff aria-hidden="true" className="atlas-inbox-muted" />Muted</>}</span>
      <span className="atlas-inbox-preview">{e.latestPost !== e.root && <b>{e.latestPost.author}: </b>}{preview}</span>
      <span className="atlas-inbox-counts">{e.count === 1 ? '1 message' : `${e.count} messages`}{unread ? <> · <strong>{e.fresh} new</strong></> : null}</span>
    </span>
  </button>;
}
