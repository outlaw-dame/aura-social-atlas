import { useEffect, useState } from 'react';
import { queueForIndex } from './useSemanticIndex';
import { Link, useNavigate } from '@tanstack/react-router';
import { Globe2, Lock, Tag, AtSign } from 'lucide-react';
import type { FedizenPost } from '@/lib/fedizen-feed';
import { shortAgo, type ForYouReason } from '@/lib/feed-types';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { MentionField } from './MentionField';
import { PostActionBar } from './PostActionBar';
import { BoostedBy, canOpen, linkifyPost, openAuthor } from './PostPeople';
import { ProfileHoverCard } from './ProfileHoverCard';
import { ReplyParent } from './ReplyParent';
import { PollView } from './PollView';
import { useIsDeleted, useIsMine } from './useOwnPosts';
import { useTagLine } from './useFeeds';
import { CollectionLinks } from './CollectionsDesktop';
import { PostArticleCard } from './ArticleAuthors';
import { VideoPlayer } from './VideoPlayer';
import { useSaveToggle } from './useFedizenLibrary';
import { FilterGate } from './FilterGate';
import { PostMoreMenu } from './FilterLikeThis';
import { AUDIENCE_LABEL, replyMention, replyVisibility, useReactions, useReply } from './usePostActions';
import { SensitiveMedia } from '@/components/social/SensitiveMedia';
import { AuthorWarning } from '@/components/social/ContentWarning';

function ChipGroupFace({ name, avatar }: { name: string; avatar?: string }) {
  const [broken, setBroken] = useState(false);
  return avatar && !broken
    ? <img src={avatar} alt="" width={16} height={16} referrerPolicy="no-referrer" loading="lazy" onError={() => setBroken(true)} className="size-4 atlas-avatar object-cover" />
    : <span aria-hidden="true" className="atlas-avatar inline-flex size-4 items-center justify-center bg-background text-[9px] font-semibold">{name.charAt(0)}</span>;
}

/** Why a post is in For You, in a few words. "Popular in" shows the group's avatar before its name; the name opens the
 *  group's page in Atlas. */
export function ReasonChips({ reasons }: { reasons?: ForYouReason[] }) {
  // Only what the reader couldn't tell already: which group made it popular. They know whom they follow, and a
  // followed hashtag shows as the post's tag line (FollowedTagLine), as Ivory does.
  const groups = (reasons ?? []).filter(r => r.kind === 'group');
  if (!groups.length) return null;
  return <p className="mb-2 flex flex-wrap gap-1.5 text-[11px] text-muted-foreground">{groups.map((r, i) =>
    <span key={i} className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5">
      Popular in {r.groupId
        ? <Link to="/groups" search={{ group: r.groupId }} className="inline-flex items-center gap-1 font-semibold text-foreground hover:underline"><ChipGroupFace name={r.group} avatar={r.avatar} />{r.group}</Link>
        : <span className="inline-flex items-center gap-1 font-semibold text-foreground"><ChipGroupFace name={r.group} />{r.group}</span>}
    </span>)}</p>;
}

/** The followed hashtags a post uses, at its top left with a tag icon and no accent colour, after Ivory. Each opens its
 *  feed. */
export function FollowedTagLine({ tags }: { tags: string[] }) {
  if (!tags.length) return null;
  return <p className="mb-1.5 flex flex-wrap items-center gap-3 text-xs font-medium text-muted-foreground">{tags.slice(0, 3).map(t =>
    <Link key={t} to="/tags/$tag" params={{ tag: t }} className="inline-flex items-center gap-1 hover:text-foreground" aria-label={`Open #${t}, a hashtag you follow`}><Tag className="size-3.5" aria-hidden="true" />{t}</Link>)}</p>;
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
    ? <img src={p.avatar} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setBroken(true)} className="size-10 shrink-0 atlas-avatar bg-muted object-cover ring-1 ring-border" />
    : <span aria-hidden="true" className="atlas-avatar flex size-10 shrink-0 items-center justify-center bg-muted font-serif text-base">{p.author.charAt(0)}</span>;
}

/** The author's avatar, name and handle. */
function Who({ post: p }: { post: FedizenPost }) {
  return <><Avatar post={p} /><span className="block min-w-0 flex-1 text-sm leading-tight"><span className="atlas-author-name block truncate font-semibold">{p.author}</span><span className="block truncate text-xs text-muted-foreground">{p.handle}</span></span></>;
}

/** Desktop: Reply, Boost, Like, Save and More (with Share), as on the phone (PostActionBar). */
function Actions({ post: p, actions }: { post: FedizenPost; actions: FeedActions }) {
  return <PostActionBar post={p} save={actions.save} reactions={actions.reactions} onReply={actions.onReply} more={<PostMoreMenu post={p} />} />;
}

/** Desktop: one post in a feed — author, text, media or link preview — with the standard post actions. */
/** Desktop: one post, unless the person's keyword filters hide it (or show it behind a notice, or blur its media). */
export function FeedPostCard(props: { post: FedizenPost; actions: FeedActions; reasons?: ForYouReason[]; /** The hashtag page this card is on. */ inTag?: string }) {
  const deleted = useIsDeleted(props.post.statusId);
  useEffect(() => { if (!deleted) queueForIndex(props.post); }, [deleted, props.post]);
  if (deleted) return null;
  return <FilterGate post={props.post}><FeedPostCardBody {...props} /></FilterGate>;
}

function FeedPostCardBody({ post: p, actions, reasons, inTag }: { post: FedizenPost; actions: FeedActions; reasons?: ForYouReason[]; /** The hashtag page this card is on. */ inTag?: string }) {
  const ago = shortAgo(p.date);
  const tagLine = useTagLine(p, reasons).filter(t => t !== inTag);
  const navigate = useNavigate();
  const mine = useIsMine(p);
  return <article className="border-b border-border pb-4" data-status-id={p.statusId}>
    <FollowedTagLine tags={tagLine} />
    <ReasonChips reasons={reasons} />
    <BoostedBy post={p} className="mb-2 flex items-center gap-1.5 text-[11px] text-muted-foreground" />
    {p.replyTo?.post && <ReplyParent post={p.replyTo.post} onTag={tag => void navigate({ to: '/tags/$tag', params: { tag } })} Gate={FilterGate} />}
    <div className="flex items-center gap-3">
      {canOpen(p)
        ? <ProfileHoverCard target={{ actor: p.actor, acct: p.acct, name: p.author }}><button type="button" className="atlas-author-button atlas-author-fill gap-3" onClick={() => openAuthor(p)} aria-label={`${p.author} ${p.handle}. Open their profile`}><Who post={p} /></button></ProfileHoverCard>
        : <Who post={p} />}
      {ago && <a href={p.url} target="_blank" rel="noopener noreferrer" className="shrink-0 text-xs text-muted-foreground hover:text-foreground hover:underline" title={p.date ? new Date(p.date).toLocaleString() : undefined}>{ago}{p.editedAt && <span className="atlas-post-edited" title={`Edited ${new Date(p.editedAt).toLocaleString()}`}> · Edited</span>}</a>}
    </div>
    <AuthorWarning cw={p.cw}>
    <div className="mt-3 space-y-2 text-sm leading-relaxed">{p.paragraphs.map((t, i) => <p key={i}>{linkifyPost(t, p.mentions, tag => void navigate({ to: '/tags/$tag', params: { tag } }))}</p>)}</div>
    <SensitiveMedia sensitive={p.sensitive}>{p.video ? <VideoPlayer video={p.video} /> : p.image && <img src={p.image} alt="" loading="lazy" referrerPolicy="no-referrer" className="mt-3 max-h-80 w-full rounded-2xl bg-muted object-cover" {...reserve(p.imageSize)} />}</SensitiveMedia>
    {p.pollState && <PollView poll={p.pollState} mine={mine} />}
    <CollectionLinks links={p.collections} />
    <PostArticleCard article={p.article} />
    </AuthorWarning>
    <Actions post={p} actions={actions} />
  </article>;
}

/** Width, height and aspect ratio for an image whose size is known, so the card keeps its height while it loads. */
const reserve = (size?: { w: number; h: number }) => (size ? { width: size.w, height: size.h, style: { aspectRatio: `${size.w} / ${size.h}` } } : {});

const AUDIENCE_ICON = { public: Globe2, unlisted: Globe2, private: Lock, direct: AtSign } as const;

/** Desktop: reply to a post, in its audience. Opens with the author's handle. */
function ReplyDialog({ post, onClose }: { post: FedizenPost | null; onClose: () => void }) {
  const r = useReply();
  const [text, setText] = useState('');
  const [confirmed, setConfirmed] = useState<string[]>([]);
  const [cw, setCw] = useState('');
  useEffect(() => { if (post) { const m = replyMention(post.handle); setText(m); setConfirmed(m ? [m.trim()] : []); setCw(post.cw ?? ''); r.clearError(); } }, [post]); // eslint-disable-line react-hooks/exhaustive-deps
  const audience = post ? replyVisibility(post) : 'public';
  const Aud = AUDIENCE_ICON[audience];
  const send = async () => { if (post && (await r.reply(post, text, cw))) onClose(); };
  return <Dialog open={!!post} onOpenChange={o => { if (!o) onClose(); }}>
    <DialogContent className="sm:max-w-lg">
      {post && <>
        <DialogHeader>
          <DialogTitle>Reply to {post.author}</DialogTitle>
          <DialogDescription className="line-clamp-2">{post.cw ? `Content warning: ${post.cw}` : post.paragraphs.join(' ')}</DialogDescription>
        </DialogHeader>
        {post.cw && <label className="block text-xs font-medium text-muted-foreground">Content warning
          <input value={cw} onChange={e => setCw(e.target.value)} maxLength={500} className="mt-1 block w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
        </label>}
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
