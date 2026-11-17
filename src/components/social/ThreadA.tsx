import { useMemo, useState, type ComponentType, type CSSProperties, type ReactNode } from 'react';
import { ArrowUpRight, ChevronDown, ChevronRight, CornerDownRight, Repeat2 } from 'lucide-react';
import type { FedizenPost } from '@/lib/fedizen-feed';
import { FOLD_ABOVE, PAGE, REPLY_SORTS, facesIn, type ReplySort, type Thread, type ThreadNode } from '@/lib/thread';
import { branchesOf, flatReplies, threadNumbers, type ReplyMode } from '@/lib/conversation';
import { isPostClick } from '@/lib/open-post';
import { openFediProfile } from '@/lib/fedi-profile';
import { shortAgo } from '@/lib/feed-types';
import { PostActionBar } from './PostActionBar';
import { Face, ParticipantsStrip, ReplyModeSwitch } from './ConversationProto';
import type { useSaveToggle } from './useFedizenLibrary';
import type { useReactions } from './usePostActions';

/**
 * Prototype A, Bonfire + Phanpy, drawn as Phanpy draws a conversation (src/pages/status.jsx, src/app.css
 * `.timeline.contextual`, src/components/status.css), on Bonfire's thread (Bonfire.Social.Threads):
 *  - one continuous column, not separate cards: avatar on the left, the post beside it;
 *  - the posts above and the opened post joined by a 3px line through the avatars; the opened post ("hero") larger,
 *    with its full date and counts and its actions always shown;
 *  - the author's self-thread marked "Thread 2/3" (Phanpy's orange Thread badge);
 *  - replies curving off the line into each avatar, indented a step per level, folded behind Phanpy's replies pill
 *    (faces, "N replies", chevron) once a conversation passes 10 replies;
 *  - Bonfire's parts: Nested or Flat (thread_mode), sorting, participants, and nesting that stops at its depth
 *    (3 on the phone, as Bonfire's default) with "Continue this thread";
 *  - Phanpy's colours for kinds of post: orange for replying-to and Thread, purple for boosts. Atlas adds one colour
 *    per branch (conversation.ts, branchesOf) to the lines, so a sub-conversation is easy to follow down the page.
 */

type Acts = { save: ReturnType<typeof useSaveToggle>; reactions: ReturnType<typeof useReactions>; onReply: (p: FedizenPost) => void };
export type ThreadAProps = {
  thread: Thread; actions: Acts; loading: boolean; partial: boolean; retry: () => void;
  sort: ReplySort; setSort: (s: ReplySort) => void; replyMode: ReplyMode; setReplyMode: (m: ReplyMode) => void;
  onOpenPost: (p: FedizenPost) => void; maxDepth: number;
  Gate: ComponentType<{ post: FedizenPost; children: ReactNode }>; Content: ComponentType<{ post: FedizenPost }>;
};

const keyOf = (p: FedizenPost) => p.statusId ?? p.id;

export function ThreadA(props: ThreadAProps) {
  const { thread: t, loading, partial, retry, sort, setSort, replyMode, setReplyMode } = props;
  const [shown, setShown] = useState(PAGE);
  const branches = useMemo(() => branchesOf(t), [t]);
  const numbers = useMemo(() => threadNumbers(t), [t]);
  const flat = useMemo(() => flatReplies(t), [t]);
  const fold = t.total > FOLD_ABOVE;
  const count = replyMode === 'flat' ? flat.length : t.replies.length;
  const host = hostOf(t.focus.url);
  const row = (p: FedizenPost, kind: RowKind, extra: Partial<RowProps> = {}) =>
    <Row post={p} kind={kind} number={numbers.get(keyOf(p))} {...props} {...extra} />;

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
    </div>
    {loading && <p className="atlas-ph-note" aria-live="polite">Loading replies…</p>}
    {partial && <p className="atlas-ph-note">Couldn’t load the rest of this conversation. <button type="button" className="atlas-ph-link" onClick={retry}>Try again</button></p>}
    {replyMode === 'flat'
      // Bonfire's flat mode, oldest first; each reply to anything but the post says which, in Phanpy's reply orange.
      ? <ol className="atlas-ph-replies atlas-ph-flat">{flat.slice(0, shown).map(r => <li key={keyOf(r.post)} className="atlas-ph-li" style={branchStyle(branches.get(keyOf(r.post)))}>
          {row(r.post, 'reply', { replyingTo: r.parent })}
        </li>)}</ol>
      : <ol className="atlas-ph-replies">{t.replies.slice(0, shown).map(n => <Branch key={keyOf(n.post)} node={n} fold={fold} branch={branches.get(keyOf(n.post))} rowProps={props} numbers={numbers} focusAuthor={t.focus.author} />)}</ol>}
    {count > shown && <button type="button" className="atlas-ph-more" onClick={() => setShown(s => s + PAGE)}>Show more replies ({count - shown})</button>}
    {!loading && host && host !== 'fedizen.net' && <p className="atlas-ph-note">
      Replies come from Fedizen, which may not have every reply from other servers yet. <a href={t.focus.url} target="_blank" rel="noopener noreferrer" className="atlas-ph-link">See it on {host}<ArrowUpRight aria-hidden="true" /></a>
    </p>}
  </div>;
}

const branchStyle = (b: number | undefined): CSSProperties | undefined => (b === undefined ? undefined : { '--branch': `var(--atlas-branch-${b})` } as CSSProperties);

function Branch({ node: n, fold, branch, rowProps, numbers, focusAuthor }: { node: ThreadNode; fold: boolean; branch?: number; rowProps: ThreadAProps; numbers: Map<string, { index: number; total: number }>; focusAuthor: string }) {
  const deeper = n.depth >= rowProps.maxDepth && n.replies.length > 0;
  const kids = !deeper && n.replies.length > 0 && <ol className="atlas-ph-replies atlas-ph-nested">
    {n.replies.map(r => <Branch key={keyOf(r.post)} node={r} fold={fold} branch={branch} rowProps={rowProps} numbers={numbers} focusAuthor={focusAuthor} />)}
  </ol>;
  return <li className="atlas-ph-li is-reply" style={{ ...branchStyle(branch), '--level': n.depth } as CSSProperties}>
    {n.part && <p className="atlas-ph-part"><CornerDownRight aria-hidden="true" />On {focusAuthor}’s post {n.part}</p>}
    <Row post={n.post} kind="reply" number={numbers.get(keyOf(n.post))} {...rowProps} />
    {deeper && <button type="button" className="atlas-ph-continue" onClick={() => rowProps.onOpenPost(n.post)}>Continue this thread ({n.size})<ChevronRight aria-hidden="true" /></button>}
    {kids && (fold
      ? <details className="atlas-ph-fold">
          <summary>
            <span className="atlas-ph-faces" aria-hidden="true">{facesIn(n).map(p => <Face key={p.handle} post={p} size={20} />)}</span>
            <span><b>{n.size}</b> {n.size === 1 ? 'reply' : 'replies'}</span>
            <ChevronDown aria-hidden="true" className="atlas-ph-chevron" />
          </summary>
          {kids}
        </details>
      : kids)}
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
