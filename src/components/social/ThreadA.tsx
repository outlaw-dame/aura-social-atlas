import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ComponentType, type CSSProperties, type ReactNode } from 'react';
import { ArrowUpRight, ChevronDown, CornerDownRight, MessageCircle, Repeat2 } from 'lucide-react';
import type { FedizenPost } from '@/lib/fedizen-feed';
import { PAGE, REPLY_SORTS, type ReplySort, type Thread, type ThreadNode } from '@/lib/thread';
import { allPosts, branchesOf, flatReplies, rootOf, threadNumbers, type ReplyMode } from '@/lib/conversation';
import { ATLAS, BONFIRE, PHANPY, atlasFolds, calibration, postHeight, bonfireFolds, bonfireMoreLabel, phanpyFolds, reasonWords, replyFaces, type AtlasFold, type AtlasReason, type PhanpyFold } from '@/lib/folding';
import { fullAcct } from '@/lib/fedizen-feed';
import { isPostClick } from '@/lib/open-post';
import { openFediProfile } from '@/lib/fedi-profile';
import { shortAgo } from '@/lib/feed-types';
import { PostActionBar } from './PostActionBar';
import { Face, FoldSwitch, NewArrivals, ParticipantsStrip, ReplyModeSwitch, justArrived, useFoldStyle, useIsMePost, useMyAcct } from './ConversationProto';
import { useFilterGate } from './FilterGate';
import { useFollowedAmong } from './useIntelligence';
import type { useSaveToggle } from './useFedizenLibrary';
import type { useReactions } from './usePostActions';

/**
 * Prototype A, Bonfire + Phanpy, drawn as Phanpy draws a conversation (src/pages/status.jsx, src/app.css
 * `.timeline.contextual`, src/components/status.css), on Bonfire's thread (Bonfire.Social.Threads):
 *  - one continuous column, not separate cards: avatar on the left, the post beside it;
 *  - the posts above and the opened post joined by a 3px line through the avatars; the opened post ("hero") larger,
 *    with its full date and counts and its actions always shown;
 *  - the author's self-thread marked "Thread 2/3" (Phanpy's orange Thread badge);
 *  - replies curving off the line into each avatar, indented a step per level;
 *  - replies hidden as Atlas does (by the screen they'd take, never hiding what the reader wants, − / + and the
 *    line by hand, collapse or expand all, find-in-page reaches folded text, remembered per conversation on this
 *    device, indentation capped with "Replying to"), or as Phanpy does (by weight, no depth limit, sideways scroll
 *    from level 4), or as Bonfire does (by sub-thread size, − / + by hand, 3 levels at a time, indented 3 levels) —
 *    folding.ts has the rules and their sources;
 *  - Bonfire's parts: Nested or Flat (thread_mode), sorting, participants;
 *  - Phanpy's colours for kinds of post: orange for replying-to and Thread, purple for boosts. Atlas adds one colour
 *    per branch (conversation.ts, branchesOf) to the lines, so a sub-conversation is easy to follow down the page.
 */

type Acts = { save: ReturnType<typeof useSaveToggle>; reactions: ReturnType<typeof useReactions>; onReply: (p: FedizenPost) => void };
export type ThreadAProps = {
  thread: Thread; actions: Acts; loading: boolean; partial: boolean; retry: () => void;
  sort: ReplySort; setSort: (s: ReplySort) => void; replyMode: ReplyMode; setReplyMode: (m: ReplyMode) => void;
  onOpenPost: (p: FedizenPost) => void;
  /** Where the reader left off before this visit (useConversationVisit), for Atlas folds' "new". */
  lastVisit: number | undefined;
  /** Replies that arrived while open and aren't shown yet, showing them, and those added, with when (useThread). */
  pending: number; onShowPending: () => void; arrived: ReadonlyMap<string, number>;
  Gate: ComponentType<{ post: FedizenPost; children: ReactNode }>; Content: ComponentType<{ post: FedizenPost }>;
};

const keyOf = (p: FedizenPost) => p.statusId ?? p.id;

/** Phanpy's cachedRepliesToggle: what the reader opened or closed, by the first reply of the set, for as long as a
 *  conversation is on screen. */
const remembered = new Map<string, boolean>();

export function ThreadA(props: ThreadAProps) {
  const { thread: t, loading, partial, retry, sort, setSort, replyMode, setReplyMode } = props;
  const [shown, setShown] = useState(PAGE);
  const [folding, setFolding] = useFoldStyle();
  const branches = useMemo(() => branchesOf(t), [t]);
  const numbers = useMemo(() => threadNumbers(t), [t]);
  const flat = useMemo(() => flatReplies(t), [t]);
  const folds = useMemo(() => phanpyFolds(t), [t]);
  useEffect(() => () => remembered.clear(), []);
  const atlas = useAtlasFolding(t, props.lastVisit, replyMode === 'nested' && folding === 'atlas');
  // After "N new replies", bring the first of them into view — or, when it sits in a folded set, that set's summary.
  const top = useRef<HTMLDivElement>(null);
  const [revealed, setRevealed] = useState(0);
  const showNew = () => { setRevealed(Date.now()); props.onShowPending(); };
  useEffect(() => {
    if (!revealed) return;
    const keys = [...props.arrived].filter(([, at]) => at >= revealed).map(([k]) => k);
    if (!keys.length) return;
    setRevealed(0);
    requestAnimationFrame(() => {
      const rows = [...(top.current?.querySelectorAll<HTMLElement>('article[data-status-id]') ?? [])].filter(r => keys.includes(r.dataset.statusId!));
      const first = rows[0];
      if (!first) return;
      const hidden = first.closest<HTMLElement>('[hidden], details:not([open])');
      const target = hidden ? (hidden.parentElement?.querySelector<HTMLElement>(':scope > .atlas-at-summary, :scope > summary') ?? hidden.parentElement ?? first) : first;
      target.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    });
  }, [props.arrived, revealed]);
  const count = replyMode === 'flat' ? flat.length : t.replies.length;
  const host = hostOf(t.focus.url);
  const row = (p: FedizenPost, kind: RowKind, extra: Partial<RowProps> = {}) =>
    <Row post={p} kind={kind} number={numbers.get(keyOf(p))} {...props} {...extra} />;
  const ctx: BranchCtx = { t, props, numbers, folds, lazy: t.total > PHANPY.lazyAbove, atlas };

  return <div className="atlas-ph" ref={el => { top.current = el; atlas.measureRef(el); }}>
    <ol className="atlas-ph-context">
      {t.missingParent && <li className="atlas-ph-gap">{t.ancestors.length ? 'Earlier posts in this conversation aren’t available.' : 'The post this replies to isn’t available.'}</li>}
      {t.ancestors.map(p => <li key={keyOf(p)} className="atlas-ph-li is-ancestor">{row(p, 'ancestor')}</li>)}
      <li className="atlas-ph-li is-hero">{row(t.focus, 'hero')}</li>
      {t.continuation.map(p => <li key={keyOf(p)} className="atlas-ph-li is-thread">{row(p, 'thread')}</li>)}
    </ol>
    <div className="atlas-ph-people"><ParticipantsStrip thread={t} /></div>
    <div className="atlas-ph-bar">
      <h2>{loading ? 'Replies' : t.replies.length ? `${t.total - t.continuation.length} ${t.total - t.continuation.length === 1 ? 'reply' : 'replies'}` : 'No replies yet'}</h2>
      {t.replies.length > 0 && <ReplyModeSwitch mode={replyMode} setMode={setReplyMode} />}
      {replyMode === 'nested' && t.replies.length > 1 && <div role="radiogroup" aria-label="Sort replies" className="atlas-proto-switch atlas-proto-small">
        {REPLY_SORTS.map(s => <button key={s.id} type="button" role="radio" aria-checked={sort === s.id} onClick={() => setSort(s.id)} className={sort === s.id ? 'is-on' : undefined}>{s.label}</button>)}
      </div>}
      {replyMode === 'nested' && t.replies.some(n => n.replies.length) && <FoldSwitch style={folding} setStyle={setFolding} />}
    </div>
    {replyMode === 'nested' && folding === 'atlas' && atlas.keys.length > 0 && <div className="atlas-at-all">
      <button type="button" onClick={() => atlas.setAll(true)}>Collapse replies</button>
      <button type="button" onClick={() => atlas.setAll(false)}>Expand all</button>
      {atlas.chose && <span className="atlas-at-note">Your folds are kept on this device only.</span>}
    </div>}
    <NewArrivals count={props.pending} onShow={showNew} one="1 new reply" many="new replies" place="top" />
    {loading && <p className="atlas-ph-note" aria-live="polite">Loading replies…</p>}
    {partial && <p className="atlas-ph-note">Couldn’t load the rest of this conversation. <button type="button" className="atlas-ph-link" onClick={retry}>Try again</button></p>}
    {replyMode === 'flat'
      // Bonfire's flat mode, oldest first; each reply to anything but the post says which, in Phanpy's reply orange.
      ? <ol className="atlas-ph-replies atlas-ph-flat">{flat.slice(0, shown).map(r => <li key={keyOf(r.post)} className="atlas-ph-li" style={branchStyle(branches.get(keyOf(r.post)))}>
          {row(r.post, 'reply', { replyingTo: r.parent })}
        </li>)}</ol>
      : <ol className={`atlas-ph-replies is-${folding}`}>{t.replies.slice(0, shown).map(n => folding === 'atlas'
          ? <AtlasBranch key={keyOf(n.post)} node={n} branch={branches.get(keyOf(n.post))} ctx={ctx} />
          : folding === 'phanpy'
          ? <PhanpyBranch key={keyOf(n.post)} node={n} branch={branches.get(keyOf(n.post))} ctx={ctx} />
          : <BonfireBranch key={keyOf(n.post)} node={n} branch={branches.get(keyOf(n.post))} ctx={ctx} loadedTo={BONFIRE.loadLevels} />)}</ol>}
    {count > shown && <button type="button" className="atlas-ph-more" onClick={() => setShown(s => s + PAGE)}>Show more replies ({count - shown})</button>}
    {!loading && host && host !== 'fedizen.net' && <p className="atlas-ph-note">
      Replies come from Fedizen, which may not have every reply from other servers yet. <a href={t.focus.url} target="_blank" rel="noopener noreferrer" className="atlas-ph-link">See it on {host}<ArrowUpRight aria-hidden="true" /></a>
    </p>}
  </div>;
}

const branchStyle = (b: number | undefined): CSSProperties | undefined => (b === undefined ? undefined : { '--branch': `var(--atlas-branch-${b})` } as CSSProperties);

type BranchCtx = { t: Thread; props: ThreadAProps; numbers: Map<string, { index: number; total: number }>; folds: Map<string, PhanpyFold>; lazy: boolean; atlas: AtlasFolding };

/** The start of a reply: which part of the author's thread it answers, and the post. */
function Head({ node: n, ctx, replyingTo }: { node: ThreadNode; ctx: BranchCtx; replyingTo?: FedizenPost }) {
  return <>
    {n.part && <p className="atlas-ph-part"><CornerDownRight aria-hidden="true" />On {ctx.t.focus.author}’s post {n.part}</p>}
    <Row post={n.post} kind="reply" number={ctx.numbers.get(keyOf(n.post))} {...ctx.props} replyingTo={replyingTo} />
  </>;
}

/* ── Phanpy: weighed, remembered, no depth limit ─────────────────────────────────────────────────────── */

function PhanpyBranch({ node: n, branch, ctx }: { node: ThreadNode; branch?: number; ctx: BranchCtx }) {
  const unloaded = !n.replies.length && (n.post.counts?.replies ?? 0) > 0 ? n.post.counts!.replies : 0;
  return <li className="atlas-ph-li is-reply" style={{ ...branchStyle(branch), '--level': n.depth } as CSSProperties}>
    <Head node={n} ctx={ctx} />
    {unloaded > 0 && <p className="atlas-ph-unloaded" title="Replies Fedizen hasn’t loaded here"><MessageCircle aria-hidden="true" />{unloaded}<span className="sr-only"> {unloaded === 1 ? 'reply' : 'replies'} not loaded here</span></p>}
    {n.replies.length > 0 && <PhanpyReplies node={n} branch={branch} ctx={ctx} />}
  </li>;
}

function PhanpyReplies({ node: n, branch, ctx }: { node: ThreadNode; branch?: number; ctx: BranchCtx }) {
  const f = ctx.folds.get(keyOf(n.post)) ?? { open: true, replies: n.replies.length, comments: n.size };
  const first = keyOf(n.replies[0].post);
  const [open, setOpen] = useState(() => remembered.get(first) ?? f.open);
  const level = n.depth;
  const list = <ol className="atlas-ph-replies atlas-ph-nested" data-level={level} data-scrolls={level === PHANPY.scrollLevel || undefined}>
    {n.replies.map(r => <PhanpyBranch key={keyOf(r.post)} node={r} branch={branch} ctx={ctx} />)}
  </ol>;
  // An open set is just the replies: no summary, nothing to close (Phanpy renders it as a plain div).
  if (f.open) return list;
  return <details className="atlas-ph-fold" open={open} onToggle={e => { const o = e.currentTarget.open; setOpen(o); remembered.set(first, o); }}>
    <summary>
      <span className="atlas-ph-faces" aria-hidden="true">{replyFaces(n).map(p => <Face key={p.handle} post={p} size={20} />)}</span>
      <span><b>{f.replies} {f.replies === 1 ? 'reply' : 'replies'}</b>{f.comments !== f.replies && f.comments > 1 && <> · {f.comments} comments</>}</span>
      <ChevronDown aria-hidden="true" className="atlas-ph-chevron" />
      <button type="button" className="atlas-ph-parent" title="View post with its replies" aria-label={`Open ${n.post.author}’s post with its replies`}
        onClick={e => { e.preventDefault(); e.stopPropagation(); ctx.props.onOpenPost(n.post); }}>»</button>
    </summary>
    {(open || !ctx.lazy) && list}
  </details>;
}

/* ── Bonfire: by sub-thread size, − / + by hand, three levels at a time ──────────────────────────────── */

function BonfireBranch({ node: n, branch, ctx, loadedTo }: { node: ThreadNode; branch?: number; ctx: BranchCtx; loadedTo: number }) {
  const auto = bonfireFolds(ctx.t, n);
  const [folded, setFolded] = useState(auto);
  const [more, setMore] = useState(false);
  const has = n.replies.length > 0;
  const atLimit = has && n.depth >= loadedTo && !more;
  const under = more ? n.depth + BONFIRE.loadLevels : loadedTo;
  const capped = n.depth >= BONFIRE.indentLevels;
  return <li className="atlas-ph-li is-reply" style={{ ...branchStyle(branch), '--level': n.depth } as CSSProperties}>
    <Head node={n} ctx={ctx} />
    {has && !atLimit && !(folded && auto) && <button type="button" className="atlas-bf-toggle" aria-expanded={!folded} aria-label={folded ? 'Show replies' : 'Hide replies'} onClick={() => setFolded(v => !v)}>{folded ? '+' : '−'}</button>}
    {atLimit && <button type="button" className="atlas-ph-continue" onClick={() => setMore(true)}>{bonfireMoreLabel(n)}</button>}
    {has && !atLimit && folded && auto && <div className="atlas-bf-summary">
      <button type="button" aria-expanded="false" onClick={() => setFolded(false)}>
        <span className="atlas-ph-faces" aria-hidden="true">{replyFaces(n).map(p => <Face key={p.handle} post={p} size={20} />)}</span>
        <span>{n.size} {n.size === 1 ? 'reply' : 'replies'}</span>
        <ChevronDown aria-hidden="true" className="atlas-ph-chevron" />
      </button>
    </div>}
    {has && !atLimit && !folded && <ol className={capped ? 'atlas-ph-replies atlas-ph-nested is-capped' : 'atlas-ph-replies atlas-ph-nested'}>
      {n.replies.map(r => <BonfireBranch key={keyOf(r.post)} node={r} branch={branch} ctx={ctx} loadedTo={under} />)}
    </ol>}
  </li>;
}

/* ── Atlas: sized to the screen, never hiding what the reader wants, every fold in the reader's hands ──── */

type AtlasFolding = {
  /** Whether a set (keyed by the post it answers) is folded: the reader's choice if they made one, else the rule. */
  folded: (k: string) => boolean;
  set: (k: string, folded: boolean) => void;
  setAll: (folded: boolean) => void;
  fold: (k: string) => AtlasFold | undefined;
  keys: string[];
  cap: number;
  measureRef: (el: HTMLDivElement | null) => void;
  /** The reader has folded or opened something here themselves. */
  chose: boolean;
};

const FOLDS_KEY = 'atlas.proto.folds';
const FOLDS_MAX = 100;
type FoldStore = Record<string, { at: number; s: Record<string, boolean> }>;
function readFolds(): FoldStore {
  try { const v = JSON.parse(localStorage.getItem(FOLDS_KEY) ?? '{}'); return v && typeof v === 'object' && !Array.isArray(v) ? v as FoldStore : {}; } catch { return {}; }
}
function writeFolds(root: string, s: Record<string, boolean>) {
  try {
    const all = readFolds();
    all[root] = { at: Date.now(), s };
    const kept = Object.fromEntries(Object.entries(all).sort(([, a], [, b]) => b.at - a.at).slice(0, FOLDS_MAX));
    localStorage.setItem(FOLDS_KEY, JSON.stringify(kept));
  } catch { /* full or blocked: per-device convenience only */ }
}

function useAtlasFolding(t: Thread, lastRead: number | undefined, active: boolean): AtlasFolding {
  const rootKey = keyOf(rootOf(t));
  const me = useMyAcct();
  const isMe = useIsMePost();
  const authorIds = useMemo(() => [...new Set(allPosts(t).map(p => p.authorId).filter((x): x is string => !!x))], [t]);
  const followed = useFollowedAmong(authorIds);
  // The space replies get on this screen, followed as the window changes.
  const [box, setBox] = useState({ w: 600, h: 800 });
  const observer = useRef<ResizeObserver | null>(null);
  const host = useRef<HTMLDivElement | null>(null);
  const measureRef = useCallback((el: HTMLDivElement | null) => {
    host.current = el;
    observer.current?.disconnect();
    if (!el || typeof ResizeObserver === 'undefined') return;
    observer.current = new ResizeObserver(() => setBox(b => {
      const w = Math.round(el.clientWidth), h = window.innerHeight;
      return Math.abs(b.w - w) < 8 && Math.abs(b.h - h) < 8 ? b : { w, h };
    }));
    observer.current.observe(el);
  }, []);
  const phone = box.w < 560;
  const wants = (p: FedizenPost): AtlasReason | undefined => {
    if (p.tombstone) return undefined;
    if (isMe(p)) return 'mine';
    if (p.handle && p.handle.toLowerCase() === t.focus.handle.toLowerCase()) return 'author';
    if (me && p.mentions?.some(m => fullAcct(m.acct)?.toLowerCase() === me)) return 'mentions';
    if (lastRead !== undefined && p.date && Date.parse(p.date) > lastRead) return 'new';
    if (p.authorId && followed.has(p.authorId)) return 'following';
    return undefined;
  };
  // The estimate corrected by what's on screen: the drawn height of the replies showing, against their estimates,
  // once per conversation and width, before paint (fonts, the reader's text size, wrapping the estimate can't know).
  const [scale, setScale] = useState(1);
  const calibrated = useRef('');
  const ready = useRef(false);
  useLayoutEffect(() => {
    const el = host.current;
    const at = `${rootKey}:${t.total}:${box.w}`;
    if (!active || !el) return;
    if (calibrated.current === at) { ready.current = true; return; }
    calibrated.current = at;
    const depth = new Map<string, ThreadNode>();
    const walk = (ns: ThreadNode[]) => ns.forEach(x => { depth.set(keyOf(x.post), x); walk(x.replies); });
    walk(t.replies);
    const pairs: [number, number][] = [];
    el.querySelectorAll<HTMLElement>('.is-atlas article.atlas-ph-row[data-status-id]').forEach(row => {
      const n = depth.get(row.dataset.statusId!);
      if (n && row.offsetHeight > 0) pairs.push([row.offsetHeight, postHeight(n.post, box.w - 78, n.depth)]);
    });
    const next = calibration(pairs);
    ready.current = Math.abs(next - scale) / scale <= 0.1;
    if (!ready.current) setScale(next);
  });
  const rules = useMemo(() => atlasFolds(t, { viewportH: box.h, width: box.w - 78, wants, scale }), [t, box, followed, me, lastRead, scale]); // eslint-disable-line react-hooks/exhaustive-deps
  // Each set's fold is decided once per visit, after calibrating: replies that arrive later, or a new measurement,
  // never open or close a set under the reader. Sets that didn't exist yet are decided when they appear.
  const decided = useRef({ root: rootKey, m: new Map<string, boolean>() });
  if (decided.current.root !== rootKey) decided.current = { root: rootKey, m: new Map() };
  useEffect(() => {
    if (!active || !ready.current) return;
    for (const [k, f] of rules) if (!decided.current.m.has(k)) decided.current.m.set(k, !f.open);
  });
  const [chosen, setChosen] = useState<Record<string, boolean>>(() => readFolds()[rootKey]?.s ?? {});
  const keys = [...rules.keys()];
  const save = (next: Record<string, boolean>) => { setChosen(next); writeFolds(rootKey, next); };
  return {
    folded: k => chosen[k] ?? decided.current.m.get(k) ?? !(rules.get(k)?.open ?? true),
    set: (k, f) => save({ ...chosen, [k]: f }),
    setAll: f => save(Object.fromEntries(keys.map(k => [k, f]))),
    fold: k => rules.get(k),
    keys,
    cap: phone ? ATLAS.indent.phone : ATLAS.indent.desktop,
    measureRef,
    chose: Object.keys(chosen).length > 0,
  };
}

function AtlasBranch({ node: n, branch, ctx, parent }: { node: ThreadNode; branch?: number; ctx: BranchCtx; parent?: FedizenPost }) {
  const a = ctx.atlas;
  const k = keyOf(n.post);
  const has = n.replies.length > 0;
  const folded = has && a.folded(k);
  const unloaded = !has && (n.post.counts?.replies ?? 0) > 0 ? n.post.counts!.replies : 0;
  const host = unloaded ? hostOf(n.post.url) : null;
  // Past the cap the replies line up under it, each saying whom it answers.
  const flat = n.depth >= a.cap;
  return <li className="atlas-ph-li is-reply" style={{ ...branchStyle(branch), '--level': n.depth } as CSSProperties}>
    <Head node={n} ctx={ctx} replyingTo={n.depth > a.cap ? parent : undefined} />
    {unloaded > 0 && <p className="atlas-ph-unloaded">
      <MessageCircle aria-hidden="true" />{unloaded} {unloaded === 1 ? 'reply' : 'replies'} not on Fedizen yet
      {host && host !== 'fedizen.net' && <> · <a href={n.post.url} target="_blank" rel="noopener noreferrer" className="atlas-ph-link">See on {host}<ArrowUpRight aria-hidden="true" /></a></>}
    </p>}
    {has && <button type="button" className="atlas-bf-toggle" aria-expanded={!folded} aria-label={folded ? `Show replies to ${n.post.author}` : `Hide replies to ${n.post.author}`} onClick={() => a.set(k, !folded)}>{folded ? '+' : '−'}</button>}
    {has && !folded && <button type="button" className="atlas-at-line" tabIndex={-1} aria-hidden="true" onClick={() => a.set(k, true)} />}
    {folded && <AtlasSummary node={n} fold={a.fold(k)} ctx={ctx} onOpen={() => a.set(k, false)} />}
    {has && <Foldable folded={folded} onFound={() => a.set(k, false)}>
      <ol className={flat ? 'atlas-ph-replies atlas-ph-nested is-capped' : 'atlas-ph-replies atlas-ph-nested'}>
        {n.replies.map(r => <AtlasBranch key={keyOf(r.post)} node={r} branch={branch} ctx={ctx} parent={n.post} />)}
      </ol>
    </Foldable>}
  </li>;
}

/** Folded replies stay in the page, hidden until found, so the browser's find opens them (hidden="until-found";
 *  where it isn't supported it is plain hidden). */
function Foldable({ folded, onFound, children }: { folded: boolean; onFound: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const found = useRef(onFound);
  found.current = onFound;
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (folded) el.setAttribute('hidden', 'until-found'); else el.removeAttribute('hidden');
  }, [folded]);
  useEffect(() => {
    const el = ref.current;
    const on = () => found.current();
    el?.addEventListener('beforematch', on);
    return () => el?.removeEventListener('beforematch', on);
  }, []);
  return <div ref={ref} className="atlas-at-fold">{children}</div>;
}

function AtlasSummary({ node: n, fold, ctx, onOpen }: { node: ThreadNode; fold?: AtlasFold; ctx: BranchCtx; onOpen: () => void }) {
  const total = fold?.total ?? n.size;
  const reasons = reasonWords(fold?.reasons ?? {});
  const latest = fold?.latest ? latestLabel(fold.latest) : '';
  return <div className="atlas-at-summary">
    <button type="button" className="atlas-at-open" aria-expanded="false" onClick={onOpen}>
      <span className="atlas-at-line1">
        <span className="atlas-ph-faces" aria-hidden="true">{replyFaces(n).map(p => <Face key={p.handle} post={p} size={20} />)}</span>
        <span><b className="nw">{n.replies.length} {n.replies.length === 1 ? 'reply' : 'replies'}</b>{total !== n.replies.length && <> · <span className="nw">{total} in total</span></>}{latest && <> · <span className="nw">latest {latest}</span></>}</span>
        <ChevronDown aria-hidden="true" className="atlas-ph-chevron" />
      </span>
      {reasons.length > 0 && <span className="atlas-at-reasons">{reasons.join(' · ')}</span>}
      <Preview post={n.replies[0].post} />
    </button>
    <button type="button" className="atlas-ph-parent atlas-at-parent" title="View post with its replies" aria-label={`Open ${n.post.author}’s post with its replies`} onClick={() => ctx.props.onOpenPost(n.post)}>»</button>
  </div>;
}

/** "2h" within a week, then the date: "Nov 16", with the year when it isn't this one. */
function latestLabel(at: number, now = Date.now()): string {
  if (now - at < 7 * 86_400_000) return shortAgo(new Date(at).toISOString());
  const d = new Date(at);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', ...(d.getFullYear() !== new Date(now).getFullYear() ? { year: 'numeric' } : {}) });
}

/** The first reply's opening words, under the reader's filters and its content warning. */
function Preview({ post: p }: { post: FedizenPost }) {
  const g = useFilterGate(p);
  if (g.kind === 'none') return null;
  if (g.kind === 'notice') return <span className="atlas-at-preview">{p.author}: hidden by your filters</span>;
  const text = p.cw?.trim() ? `Content warning: ${p.cw.trim()}` : (p.paragraphs.find(x => x.trim()) ?? (p.image || p.video ? 'Media' : '')).trim();
  if (!text) return null;
  return <span className="atlas-at-preview"><b>{p.author}</b> {text.length > 110 ? `${text.slice(0, 108).replace(/\s+\S*$/, '')}…` : text}</span>;
}

type RowKind = 'ancestor' | 'hero' | 'thread' | 'reply';
type RowProps = ThreadAProps & { post: FedizenPost; kind: RowKind; number?: { index: number; total: number }; replyingTo?: FedizenPost };

function Row({ post: p, kind, number, replyingTo, actions, onOpenPost, arrived, Gate, Content }: RowProps) {
  const [active, setActive] = useState(false);
  const hero = kind === 'hero';
  // Deleted while open, or gone from the conversation: its place, so replies to it still read as replies to something.
  if (p.tombstone) return <article className={`atlas-ph-row is-${kind} is-tombstone`} data-status-id={p.statusId}>
    <div className="atlas-ph-av"><span className="atlas-ph-ghost" aria-hidden="true" /></div>
    <div className="atlas-ph-main"><p className="atlas-ph-gone">This post was deleted or is no longer available.</p></div>
  </article>;
  const ago = shortAgo(p.date);
  const profile = p.actor || p.acct ? () => openFediProfile({ actor: p.actor, acct: p.acct, name: p.author }) : undefined;
  return <Gate post={p}>
    <article className={['atlas-ph-row', `is-${kind}`, p.boostedBy && 'is-boost', active && 'is-active', justArrived(arrived, keyOf(p)) && 'is-arrived'].filter(Boolean).join(' ')} data-status-id={p.statusId}
      onClick={e => {
        if (!isPostClick(e)) return;
        if (hero) return;
        // A tap on a coarse pointer shows the actions first; a second opens the post, as Phanpy's status-link does.
        if (matchMedia('(pointer: coarse)').matches && !active) { setActive(true); return; }
        onOpenPost(p);
      }}>
      <div className="atlas-ph-av">
        {profile ? <button type="button" onClick={profile} aria-label={`${p.author}, open their profile`}><Face post={p} size={hero ? 48 : 40} /></button> : <Face post={p} size={hero ? 48 : 40} />}
      </div>
      <div className="atlas-ph-main">
        <header className="atlas-ph-meta">
          {profile ? <button type="button" className="atlas-ph-name" onClick={profile}>{p.author}</button> : <b className="atlas-ph-name">{p.author}</b>}
          <span className="atlas-ph-handle">{p.handle}</span>
          {number && <span className="atlas-ph-badge is-thread">Thread {number.index}/{number.total}</span>}
          {!hero && ago && <button type="button" className="atlas-ph-time" onClick={() => onOpenPost(p)} title={p.date ? new Date(p.date).toLocaleString() : undefined} aria-label={`Open the conversation, posted ${p.date ? new Date(p.date).toLocaleString() : ago}`}>{ago}</button>}
        </header>
        {p.boostedBy && <p className="atlas-ph-boost"><Repeat2 aria-hidden="true" />{p.boostedBy} boosted</p>}
        {replyingTo && <p className="atlas-ph-replyto"><CornerDownRight aria-hidden="true" />Replying to <b>{replyingTo.author}</b></p>}
        <div className={hero ? 'atlas-ph-content is-large' : 'atlas-ph-content'}><Content post={p} /></div>
        {hero && <HeroDetails post={p} />}
        <div className="atlas-ph-actions"><PostActionBar post={p} save={actions.save} reactions={actions.reactions} onReply={actions.onReply} /></div>
      </div>
    </article>
  </Gate>;
}

function HeroDetails({ post: p }: { post: FedizenPost }) {
  const c = p.counts;
  const n = (v: number, one: string, many: string) => `${v.toLocaleString()} ${v === 1 ? one : many}`;
  return <p className="atlas-ph-hero-meta">
    {p.date && <time dateTime={p.date}>{new Date(p.date).toLocaleString(undefined, { dateStyle: 'long', timeStyle: 'short' })}</time>}
    {p.editedAt && <> · Edited</>}
    {c && (c.replies || c.boosts || c.likes) ? <> · {[n(c.replies, 'reply', 'replies'), n(c.boosts, 'boost', 'boosts'), n(c.likes, 'like', 'likes')].join(' · ')}</> : null}
  </p>;
}

function hostOf(url: string): string | null {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return null; }
}
