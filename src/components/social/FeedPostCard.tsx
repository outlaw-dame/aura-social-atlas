import { useEffect, useState } from 'react';
import { Bookmark, Globe2, Hash, Heart, Lock, MessageCircle, MessagesSquare, Repeat2, Share, UserCheck, AtSign } from 'lucide-react';
import type { FedizenPost } from '@/lib/fedizen-feed';
import { shortAgo, type ForYouReason } from '@/lib/feed-types';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { MentionField } from './MentionField';
import { CollectionLinks } from './CollectionsDesktop';
import { PostArticleCard } from './ArticleAuthors';
import { VideoPlayer } from './VideoPlayer';
import { useSaveToggle } from './useFedizenLibrary';
import { AUDIENCE_LABEL, compactCount, replyMention, replyVisibility, sharePost, useReactions, useReply } from './usePostActions';

/** Why a post is in For You, in a few words. */
export function ReasonChips({ reasons }: { reasons?: ForYouReason[] }) {
  if (!reasons?.length) return null;
  return <p className="mb-2 flex flex-wrap gap-1.5 text-[11px] text-muted-foreground">{reasons.map((r, i) =>
    <span key={i} className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5">
      {r.kind === 'tag' ? <><Hash className="size-3" />{r.tag}</> : r.kind === 'group' ? <><MessagesSquare className="size-3" />Popular in {r.group}</> : <><UserCheck className="size-3" />You follow</>}
    </span>)}</p>;
}

/** Everything a desktop feed of post cards shares: Save, Like and Boost state, and the reply dialog (render `dialog` once). */
export function useFeedPostActions() {
  const save = useSaveToggle();
  const reactions = useReactions();
  const [replying, setReplying] = useState<FedizenPost | null>(null);
  return { save, reactions, onReply: setReplying, error: save.error ?? reactions.error, dialog: <ReplyDialog post={replying} onClose={() => setReplying(null)} /> };
}
export type FeedActions = ReturnType<typeof useFeedPostActions>;

function Avatar({ post: p }: { post: FedizenPost }) {
  const [broken, setBroken] = useState(false);
  return p.avatar && !broken
    ? <img src={p.avatar} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setBroken(true)} className="size-10 shrink-0 rounded-full object-cover ring-1 ring-border" />
    : <span aria-hidden="true" className="flex size-10 shrink-0 items-center justify-center rounded-full bg-muted font-serif text-base">{p.author.charAt(0)}</span>;
}

const actionClass = 'inline-flex min-h-9 min-w-9 items-center gap-1.5 rounded-full px-2 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50 aria-pressed:text-accent';

/** Desktop: Reply, Boost, Like, Save and Share. A post Fedizen's API can't address offers Share only. */
function Actions({ post: p, actions }: { post: FedizenPost; actions: FeedActions }) {
  const { save, reactions, onReply } = actions;
  const acts = !!p.statusId && reactions.canAct;
  const like = reactions.state(p, 'like'), boost = reactions.state(p, 'boost'), saved = save.isSaved(p);
  const boostable = p.visibility !== 'private' && p.visibility !== 'direct';
  const [copied, setCopied] = useState(false);
  return <div className="mt-3 flex items-center gap-1" role="group" aria-label="Post actions">
    {acts && <>
      <button type="button" className={actionClass} onClick={() => onReply(p)} aria-label="Reply"><MessageCircle className="size-4" />{compactCount(p.counts?.replies ?? 0)}</button>
      <button type="button" className={actionClass} disabled={boost.pending || !boostable} aria-pressed={boost.on} onClick={() => void reactions.toggle(p, 'boost')} aria-label={boost.on ? 'Undo boost' : 'Boost'} title={boostable ? undefined : 'Only public posts can be boosted'}><Repeat2 className="size-4" />{compactCount(boost.count)}</button>
      <button type="button" className={actionClass} disabled={like.pending} aria-pressed={like.on} onClick={() => void reactions.toggle(p, 'like')} aria-label={like.on ? 'Unlike' : 'Like'}><Heart className={`size-4${like.on ? ' fill-current' : ''}`} />{compactCount(like.count)}</button>
      {save.canSave && <button type="button" className={actionClass} disabled={save.isPending(p)} aria-pressed={saved} onClick={() => void save.toggle(p)} aria-label={saved ? 'Remove from saved' : 'Save'}><Bookmark className={`size-4${saved ? ' fill-current' : ''}`} /></button>}
    </>}
    <button type="button" className={`${actionClass} ml-auto`} aria-label="Share" onClick={async () => { if ((await sharePost(p)) === 'copied') { setCopied(true); setTimeout(() => setCopied(false), 1500); } }}>
      <Share className="size-4" />{copied && 'Link copied'}
    </button>
  </div>;
}

/** Desktop: one post in a feed — author, text, media or link preview — with the standard post actions. */
export function FeedPostCard({ post: p, actions, reasons }: { post: FedizenPost; actions: FeedActions; reasons?: ForYouReason[] }) {
  const ago = shortAgo(p.date);
  return <article className="border-b border-border pb-4">
    <ReasonChips reasons={reasons} />
    {p.boostedBy && <p className="mb-2 flex items-center gap-1 text-[11px] text-muted-foreground"><Repeat2 className="size-3" />{p.boostedBy} boosted</p>}
    <div className="flex items-center gap-3">
      <Avatar post={p} />
      <p className="min-w-0 flex-1 text-sm leading-tight"><span className="block truncate font-semibold">{p.author}</span><span className="block truncate text-xs text-muted-foreground">{p.handle}</span></p>
      {ago && <a href={p.url} target="_blank" rel="noopener noreferrer" className="shrink-0 text-xs text-muted-foreground hover:text-foreground hover:underline" title={p.date ? new Date(p.date).toLocaleString() : undefined}>{ago}</a>}
    </div>
    <div className="mt-3 space-y-2 text-sm leading-relaxed">{p.paragraphs.map((t, i) => <p key={i}>{t}</p>)}</div>
    {p.video ? <VideoPlayer video={p.video} /> : p.image && <img src={p.image} alt="" loading="lazy" referrerPolicy="no-referrer" className="mt-3 max-h-80 w-full rounded-2xl object-cover" />}
    <CollectionLinks links={p.collections} />
    <PostArticleCard article={p.article} />
    <Actions post={p} actions={actions} />
  </article>;
}

const AUDIENCE_ICON = { public: Globe2, unlisted: Globe2, private: Lock, direct: AtSign } as const;

/** Desktop: reply to a post, in its audience. Opens with the author's handle. */
function ReplyDialog({ post, onClose }: { post: FedizenPost | null; onClose: () => void }) {
  const r = useReply();
  const [text, setText] = useState('');
  const [confirmed, setConfirmed] = useState<string[]>([]);
  useEffect(() => { if (post) { const m = replyMention(post.handle); setText(m); setConfirmed(m ? [m.trim()] : []); r.clearError(); } }, [post]); // eslint-disable-line react-hooks/exhaustive-deps
  const audience = post ? replyVisibility(post) : 'public';
  const Aud = AUDIENCE_ICON[audience];
  const send = async () => { if (post && (await r.reply(post, text))) onClose(); };
  return <Dialog open={!!post} onOpenChange={o => { if (!o) onClose(); }}>
    <DialogContent className="sm:max-w-lg">
      {post && <>
        <DialogHeader>
          <DialogTitle>Reply to {post.author}</DialogTitle>
          <DialogDescription className="line-clamp-2">{post.paragraphs.join(' ')}</DialogDescription>
        </DialogHeader>
        <MentionField value={text} onChange={setText} confirmed={confirmed} onConfirm={t => setConfirmed(c => [...c, t])} autoFocus
          people={[{ handle: post.handle, name: post.author, avatar: post.avatar }]} placeholder="Write your reply" label="Your reply" onSubmit={() => void send()} />
        <p className="flex items-center gap-1 text-xs text-muted-foreground"><Aud className="size-3.5" />{AUDIENCE_LABEL[audience]}, like the post</p>
        {r.error && <p role="alert" className="text-sm text-destructive">{r.error}</p>}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={() => void send()} disabled={!text.trim() || text.trim() === replyMention(post.handle).trim() || r.sending}>{r.sending ? 'Posting…' : 'Reply'}</Button>
        </DialogFooter>
      </>}
    </DialogContent>
  </Dialog>;
}
