import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ComponentType, type CSSProperties, type ReactNode } from 'react';
import { useQueries, useQuery } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { ArrowDown, ArrowUp, BellOff, Bell, CornerDownRight, MessageSquareReply } from 'lucide-react';
import type { FedizenPost } from '@/lib/fedizen-feed';
import { fullAcct } from '@/lib/fedizen-feed';
import { shortAgo } from '@/lib/feed-types';
import { buildThread, type Thread } from '@/lib/thread';
import type { FoldStyle } from '@/lib/folding';
import { compareFolds } from '@/lib/compare-folds';
import { allPosts, branchesOf, chatItems, latestTime, participantsOf, readMarks, rootOf, subjectOf, unreadIn, writeMark, type ProtoStyle, type ReplyMode } from '@/lib/conversation';
import { getFedizenStatus, getFedizenThread } from '@/lib/fedizen.functions';
import { useSaveToggle } from './useFedizenLibrary';
import { useReactions } from './usePostActions';
import { PostActionBar } from './PostActionBar';
import { useFilterGate } from './FilterGate';
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
/**
 * How replies fold. Atlas folds is the design; Phanpy's and Bonfire's own rules stay available for comparison only to
 * someone who asks for them: opening any page with ?compare-folds=1 shows the switch on this device (=0 hides it
 * again). Without it, conversations always use Atlas folds, whatever was chosen before.
 */
export function useFoldStyle(): [FoldStyle, (s: FoldStyle) => void, boolean] {
  const [compare] = useState(compareFolds);
  const [style, setStyle] = useStored<FoldStyle>('atlas.proto.folding', ['atlas', 'phanpy', 'bonfire'], 'atlas');
  return [compare ? style : 'atlas', setStyle, compare];
}
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

const FOLDS: { id: FoldStyle; label: string }[] = [{ id: 'atlas', label: 'Atlas folds' }, { id: 'phanpy', label: 'Phanpy folds' }, { id: 'bonfire', label: 'Bonfire folds' }];

/** A, nested: whose way of hiding replies to use (folding.ts). */
export function FoldSwitch({ style, setStyle }: { style: FoldStyle; setStyle: (s: FoldStyle) => void }) {
  return <div role="radiogroup" aria-label="Hide replies the way" className="atlas-proto-switch atlas-proto-small">
    {FOLDS.map(f => <button key={f.id} type="button" role="radio" aria-checked={style === f.id} onClick={() => setStyle(f.id)} className={style === f.id ? 'is-on' : undefined}>{f.label}</button>)}
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
/** The reader's full Fedizen handle, lower case, once known. */
export function useMyAcct(): string | undefined {
  const { user } = useAtlasAuth();
  const statusFn = useServerFn(getFedizenStatus);
  const status = useQuery({ queryKey: ['fedizen-status', user?.id], queryFn: () => statusFn(), enabled: !!user, staleTime: 60_000 });
  return fullAcct(status.data?.handle)?.toLowerCase();
}

export function useIsMePost() {
  const me = useMyAcct();
  return (p: FedizenPost) => !!me && fullAcct(p.acct ?? p.handle)?.toLowerCase() === me;
}

type Acts = { save: ReturnType<typeof useSaveToggle>; reactions: ReturnType<typeof useReactions>; onReply: (p: FedizenPost) => void };

/* ── B: the conversation ────────────────────────────────────────────────────────────────────────────── */

/**
 * Keeps the reader's place while a conversation changes under them (replies arriving, edits, placeholders): before
 * the change shows, which post is being read and where; once it shows, scroll by however far that post moved. Done here rather than left to the browser's scroll anchoring, which not every browser has.
 */
export function useScrollAnchor(root: { current: HTMLElement | null }, version: unknown, selector = '[data-status-id]') {
  const snap = useRef<{ k: string; top: number } | null>(null);
  const seen = useRef(version);
  // Read while rendering the new version, before React changes the page.
  if (seen.current !== version) {
    seen.current = version;
    snap.current = null;
    // The post being read: the one across the line 40% down the screen (or the first below it). Changes above it are
    // made up for; changes below it don't move it anyway.
    const line = (typeof window === 'undefined' ? 0 : window.innerHeight) * 0.4;
    for (const el of root.current?.querySelectorAll<HTMLElement>(selector) ?? []) {
      const r = el.getBoundingClientRect();
      if (r.height > 0 && r.bottom > line) { snap.current = { k: el.getAttribute(selector.slice(1, -1)) ?? '', top: r.top }; break; }
    }
  }
  useLayoutEffect(() => {
    const s = snap.current;
    snap.current = null;
    if (!s?.k || !root.current) return;
    const attr = selector.slice(1, -1);
    const el = [...root.current.querySelectorAll<HTMLElement>(selector)].find(x => x.getAttribute(attr) === s.k);
    if (!el) return;
    const moved = el.getBoundingClientRect().top - s.top;
    if (Math.abs(moved) < 1) return;
    const scroller = el.closest<HTMLElement>('.page-content');
    if (scroller) scroller.scrollTop += moved; else window.scrollBy(0, moved);
  }, [version]); // eslint-disable-line react-hooks/exhaustive-deps
}

/** For screen readers, what just arrived ("2 new replies"), since the page itself doesn't move to show it. */
export function ArrivalNote({ arrived, one, many }: { arrived: ReadonlyMap<string, number> | undefined; one: string; many: string }) {
  const latest = Math.max(0, ...(arrived?.values() ?? []));
  const count = latest ? [...arrived!.values()].filter(at => at === latest).length : 0;
  return <p className="sr-only" role="status" aria-live="polite">{count ? (count === 1 ? one : `${count} ${many}`) : ''}</p>;
}

/** Posts added in the last few seconds get a short highlight (styles.css .is-arrived), once. */
export const justArrived = (arrived: ReadonlyMap<string, number> | undefined, k: string, now = Date.now()) => {
  const at = arrived?.get(k);
  return at !== undefined && now - at < 10_000;
};

/**
 * One visit to a conversation, shared by both prototypes: where the reader left off before it (read once, when the
 * conversation is first known on this page, so switching between A and B mid-visit shows the same posts as new) and,
 * once Fedizen has answered, this visit recorded as read up to the newest post shown — again whenever more are shown
 * (new replies wait until the reader asks for them, so they aren't marked read unseen). Kept on this device
 * (conversation.ts, readMarks).
 */
export function useConversationVisit(t: Thread | null, loaded: boolean): number | undefined {
  const root = t ? rootOf(t) : null;
  const rootKey = root ? root.statusId ?? root.id : null;
  const before = useRef<{ root: string; at?: number } | null>(null);
  if (rootKey && before.current?.root !== rootKey) before.current = { root: rootKey, at: readMarks()[rootKey]?.lastRead };
  useEffect(() => {
    if (!t || !root || !rootKey || !loaded) return;
    const at = before.current?.at;
    writeMark(rootKey, { lastRead: Math.max(latestTime(allPosts(t)), at ?? 0), seenAt: Date.now(), opened: t.focus.statusId ?? t.focus.id, subject: subjectOf(root) });
  }, [loaded, rootKey, t]); // eslint-disable-line react-hooks/exhaustive-deps
  return before.current?.at;
}

/**
 * B: Wavelength's conversation over Bonfire's thread. A subject and the people in it; messages oldest first with
 * day separators; a "New" line where you left off last time (and a button to jump there); a mute that quiets the
 * conversation in the Conversations list; replies that don't answer the message above say which one they answer.
 * Each message keeps Atlas's actions (shown on hover or tap); "Reply" at the bottom answers the opened post.
 */
export function ChatConversation({ thread: t, actions, onOpenInbox, onOpenPost, lastVisit, arrived, Gate, Content }: {
  thread: Thread; actions: Acts; onOpenInbox: () => void; onOpenPost: (p: FedizenPost) => void;
  /** The platform's keyword-filter gate (FilterGate, MobileFilterGate) and post content (PostContent,
   *  MobilePostContent: warnings, sensitive media, video, polls, previews), so B shows exactly what a card would. */
  Gate: ComponentType<{ post: FedizenPost; children: ReactNode }>; Content: ComponentType<{ post: FedizenPost }>;
  /** Where the reader left off before this visit (useConversationVisit), for the "New" line. */ lastVisit: number | undefined;
  /** Messages added while open, and when (useThread): marked New. */ arrived?: ReadonlyMap<string, number>;
}) {
  const isMe = useIsMePost();
  const posts = useMemo(() => allPosts(t), [t]);
  // The same colour per branch as prototype A, so a sub-conversation can be followed as it interleaves.
  const branches = useMemo(() => branchesOf(t), [t]);
  const root = rootOf(t);
  const rootKey = root.statusId ?? root.id;
  const subject = subjectOf(root);
  // Mutes only: the visit itself is recorded once per page by useConversationVisit, for A and B alike.
  const [mark, setMark] = useState(() => readMarks()[rootKey]);
  const items = useMemo(() => chatItems(posts, t.focus.statusId ?? t.focus.id, lastVisit), [posts, t.focus, lastVisit]);
  const people = participantsOf(posts);
  const fresh = lastVisit === undefined ? 0 : unreadIn(posts, lastVisit, isMe);
  const muted = !!mark?.muted;
  const toggleMute = () => setMark(writeMark(rootKey, { muted: !muted })[rootKey]);
  const [active, setActive] = useState<string | null>(null);
  // As in a chat: new messages appear at once; read at the end and the conversation follows them down, read further
  // up and nothing moves (useScrollAnchor), the new ones marked New for when you get there.
  const end = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLElement>(null);
  const atEnd = useRef(false);
  useEffect(() => {
    const el = end.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(([e]) => { atEnd.current = e.isIntersecting; }, { rootMargin: '0px 0px 120px 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  useScrollAnchor(box, t);
  const count = arrived?.size ?? 0;
  useLayoutEffect(() => { if (count && atEnd.current) end.current?.scrollIntoView({ block: 'end' }); }, [count]);
  const jump = () => document.getElementById('atlas-conv-new')?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });

  return <section ref={box} className="atlas-conv" aria-label={`Conversation: ${subject}`}>
    <ArrivalNote arrived={arrived} one="1 new message" many="new messages" />
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
        : it.post.tombstone
        ? <li key={it.key} className="atlas-conv-item"><div className="atlas-conv-msg is-first is-tombstone"><div className="atlas-conv-gutter" /><p className="atlas-conv-gone">This message was deleted or is no longer available.</p></div></li>
        : <li key={it.key} className={justArrived(arrived, it.key) ? 'atlas-conv-item is-arrived' : 'atlas-conv-item'} style={branches.has(it.key) ? { '--branch': `var(--atlas-branch-${branches.get(it.key)})` } as CSSProperties : undefined}><Gate post={it.post}><Message item={it} actions={actions} mine={isMe(it.post)} fresh={!isMe(it.post) && !!arrived?.has(it.key)} active={active === it.key} onActivate={() => setActive(a => (a === it.key ? null : it.key))} onOpenPost={onOpenPost} Content={Content} /></Gate></li>)}
    </ol>
    <div ref={end} className="atlas-conv-end" aria-hidden="true" />
    <div className="atlas-conv-dock">
      <button type="button" className="atlas-conv-reply" onClick={() => actions.onReply(t.focus)} disabled={!actions.reactions.canAct}>
        <MessageSquareReply aria-hidden="true" />{actions.reactions.canAct ? `Reply to ${t.focus.author}` : 'Connect Fedizen to reply'}
      </button>
    </div>
  </section>;
}

function Message({ item, actions, mine, fresh, active, onActivate, onOpenPost, Content }: { item: Extract<ReturnType<typeof chatItems>[number], { t: 'msg' }>; actions: Acts; mine: boolean; fresh: boolean; active: boolean; onActivate: () => void; onOpenPost: (p: FedizenPost) => void; Content: ComponentType<{ post: FedizenPost }> }) {
  const p = item.post;
  const time = p.date ? new Date(p.date) : null;
  return <div className={['atlas-conv-msg', item.first && 'is-first', mine && 'is-mine', item.focus && 'is-focus', active && 'is-active', fresh && 'is-new'].filter(Boolean).join(' ')} data-status-id={p.statusId ?? p.id}>
    <div className="atlas-conv-gutter">{item.first && <Face post={p} size={32} />}</div>
    <div className="atlas-conv-main" onClick={e => { const t = e.target as Element; if (!t.closest('a, button, summary, video, audio, input, label')) onActivate(); }}>
      {fresh && !item.first && <span className="atlas-new-badge is-alone">New</span>}
      {item.first && <p className="atlas-conv-who"><b>{p.author}</b> <span>{p.handle}</span>{fresh && <span className="atlas-new-badge">New</span>}{time && <time dateTime={p.date} title={time.toLocaleString()}>{time.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}</time>}{p.editedAt && <span> · Edited</span>}</p>}
      {item.parent && <ParentChip parent={item.parent} />}
      <div id={`atlas-msg-${p.statusId ?? p.id}`} className="atlas-conv-body">
        <BoostedBy post={p} className="atlas-post-boosted" />
        <Content post={p} />
      </div>
      <div className="atlas-conv-actions">
        <PostActionBar post={p} save={actions.save} reactions={actions.reactions} onReply={actions.onReply}
          more={!item.focus && p.statusId ? <button type="button" className="atlas-conv-open" onClick={() => onOpenPost(p)}>Open</button> : undefined} />
      </div>
    </div>
  </div>;
}

/** What a message answers. Its words show only when the reader's filters let that post show, and never past a
 *  content warning. */
function ParentChip({ parent }: { parent: FedizenPost }) {
  const g = useFilterGate(parent);
  const words = g.kind === 'show' && !parent.cw ? (parent.paragraphs[0] ?? '').slice(0, 80) : '';
  return <button type="button" className="atlas-conv-parent" onClick={() => document.getElementById(`atlas-msg-${parent.statusId ?? parent.id}`)?.scrollIntoView({ block: 'center' })}>
    <CornerDownRight aria-hidden="true" /><span>{parent.tombstone ? 'Replying to a deleted message' : <>Replying to <b>{parent.author}</b>{words && <>: {words}</>}</>}</span>
  </button>;
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
