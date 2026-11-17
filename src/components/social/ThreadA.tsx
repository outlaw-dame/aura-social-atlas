import { useEffect, useMemo, useState, type ComponentType, type CSSProperties, type ReactNode } from 'react';
import { ArrowUpRight, ChevronDown, CornerDownRight, MessageCircle, Repeat2 } from 'lucide-react';
import type { FedizenPost } from '@/lib/fedizen-feed';
import { PAGE, REPLY_SORTS, type ReplySort, type Thread, type ThreadNode } from '@/lib/thread';
import { branchesOf, flatReplies, threadNumbers, type ReplyMode } from '@/lib/conversation';
import { BONFIRE, PHANPY, bonfireFolds, bonfireMoreLabel, phanpyFolds, replyFaces, type FoldStyle, type PhanpyFold } from '@/lib/folding';
import { isPostClick } from '@/lib/open-post';
import { openFediProfile } from '@/lib/fedi-profile';
import { shortAgo } from '@/lib/feed-types';
import { PostActionBar } from './PostActionBar';
import { Face, FoldSwitch, ParticipantsStrip, ReplyModeSwitch, useFoldStyle } from './ConversationProto';
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
 *  - replies hidden either as Phanpy hides them (by weight, no depth limit, sideways scroll from level 4) or as
 *    Bonfire does (by sub-thread size, − / + by hand, 3 levels at a time, indented 3 levels) — folding.ts has both
 *    rules and their sources;
 *  - Bonfire's parts: Nested or Flat (thread_mode), sorting, participants;
 *  - Phanpy's colours for kinds of post: orange for replying-to and Thread, purple for boosts. Atlas adds one colour
 *    per branch (conversation.ts, branchesOf) to the lines, so a sub-conversation is easy to follow down the page.
 */

type Acts = { save: ReturnType<typeof useSaveToggle>; reactions: ReturnType<typeof useReactions>; onReply: (p: FedizenPost) => void };
export type ThreadAProps = {
  thread: Thread; actions: Acts; loading: boolean; partial: boolean; retry: () => void;
  sort: ReplySort; setSort: (s: ReplySort) => void; replyMode: ReplyMode; setReplyMode: (m: ReplyMode) => void;
  onOpenPost: (p: FedizenPost) => void;
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
  const count = replyMode === 'flat' ? flat.length : t.replies.length;
  const host = hostOf(t.focus.url);
  const row = (p: FedizenPost, kind: RowKind, extra: Partial<RowProps> = {}) =>
    <Row post={p} kind={kind} number={numbers.get(keyOf(p))} {...props} {...extra} />;
  const ctx: BranchCtx = { t, props, numbers, folds, lazy: t.total > PHANPY.lazyAbove };

  return <div className="atlas-ph">
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
    {loading && <p className="atlas-ph-note" aria-live="polite">Loading replies…</p>}
    {partial && <p className="atlas-ph-note">Couldn’t load the rest of this conversation. <button type="button" className="atlas-ph-link" onClick={retry}>Try again</button></p>}
    {replyMode === 'flat'
      // Bonfire's flat mode, oldest first; each reply to anything but the post says which, in Phanpy's reply orange.
      ? <ol className="atlas-ph-replies atlas-ph-flat">{flat.slice(0, shown).map(r => <li key={keyOf(r.post)} className="atlas-ph-li" style={branchStyle(branches.get(keyOf(r.post)))}>
          {row(r.post, 'reply', { replyingTo: r.parent })}
        </li>)}</ol>
      : <ol className={`atlas-ph-replies is-${folding}`}>{t.replies.slice(0, shown).map(n => folding === 'phanpy'
          ? <PhanpyBranch key={keyOf(n.post)} node={n} branch={branches.get(keyOf(n.post))} ctx={ctx} />
          : <BonfireBranch key={keyOf(n.post)} node={n} branch={branches.get(keyOf(n.post))} ctx={ctx} loadedTo={BONFIRE.loadLevels} />)}</ol>}
    {count > shown && <button type="button" className="atlas-ph-more" onClick={() => setShown(s => s + PAGE)}>Show more replies ({count - shown})</button>}
    {!loading && host && host !== 'fedizen.net' && <p className="atlas-ph-note">
      Replies come from Fedizen, which may not have every reply from other servers yet. <a href={t.focus.url} target="_blank" rel="noopener noreferrer" className="atlas-ph-link">See it on {host}<ArrowUpRight aria-hidden="true" /></a>
    </p>}
  </div>;
}

const branchStyle = (b: number | undefined): CSSProperties | undefined => (b === undefined ? undefined : { '--branch': `var(--atlas-branch-${b})` } as CSSProperties);

type BranchCtx = { t: Thread; props: ThreadAProps; numbers: Map<string, { index: number; total: number }>; folds: Map<string, PhanpyFold>; lazy: boolean };

/** The start of a reply: which part of the author's thread it answers, and the post. */
function Head({ node: n, ctx }: { node: ThreadNode; ctx: BranchCtx }) {
  return <>
    {n.part && <p className="atlas-ph-part"><CornerDownRight aria-hidden="true" />On {ctx.t.focus.author}’s post {n.part}</p>}
    <Row post={n.post} kind="reply" number={ctx.numbers.get(keyOf(n.post))} {...ctx.props} />
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

type RowKind = 'ancestor' | 'hero' | 'thread' | 'reply';
type RowProps = ThreadAProps & { post: FedizenPost; kind: RowKind; number?: { index: number; total: number }; replyingTo?: FedizenPost };

function Row({ post: p, kind, number, replyingTo, actions, onOpenPost, Gate, Content }: RowProps) {
  const [active, setActive] = useState(false);
  const hero = kind === 'hero';
  const ago = shortAgo(p.date);
  const profile = p.actor || p.acct ? () => openFediProfile({ actor: p.actor, acct: p.acct, name: p.author }) : undefined;
  return <Gate post={p}>
    <article className={['atlas-ph-row', `is-${kind}`, p.boostedBy && 'is-boost', active && 'is-active'].filter(Boolean).join(' ')} data-status-id={p.statusId}
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
