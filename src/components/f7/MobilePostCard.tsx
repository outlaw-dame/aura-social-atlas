import { useEffect, useState } from 'react';
import { queueForIndex } from '@/components/social/useSemanticIndex';
import { Card, CardContent, CardFooter, Link } from 'framework7-react';
import { foldCredits, type FedizenPost } from '@/lib/fedizen-feed';
import { shortAgo, type ForYouReason } from '@/lib/feed-types';
import { openCollection } from '@/lib/collections';
import { openGroup } from '@/lib/groups';
import { openTag } from '@/lib/hashtags';
import { BoostedBy, canOpen, openAuthor } from '@/components/social/PostPeople';
import { ReplyParent } from '@/components/social/ReplyParent';
import { PollView } from '@/components/social/PollView';
import { useIsDeleted, useIsMine } from '@/components/social/useOwnPosts';
import { useTagLine } from '@/components/social/useFeeds';
import { VideoPlayer } from '@/components/social/VideoPlayer';
import { useSaveToggle } from '@/components/social/useFedizenLibrary';
import { useReactions } from '@/components/social/usePostActions';
import { ArticleCard, AuthorRows } from './ArticleAuthors';
import { MobilePostActions, ReplySheet } from './PostActions';
import { Icon } from './F7Extras';
import { MobileFilterGate } from './FilterGate';
import { pushPage } from './navigation';
import { TranslationLineView, usePostTranslation } from '@/components/social/useTranslation';
import { SensitiveMedia } from '@/components/social/SensitiveMedia';
import { AuthorWarning } from '@/components/social/ContentWarning';
import type { CardMode } from '@/components/social/FeedPostCard';
import { isPostClick, isStatusId, openPost } from '@/lib/open-post';
import { PostBody } from '@/components/social/PostBody';
import { useLiveAvatar } from '@/components/social/useLiveAvatar';

/** A group's avatar in a reason chip: its picture, else its initial, as a rounded square (groups are squares). */
function ChipGroupFace({ name, avatar }: { name: string; avatar?: string }) {
  const [broken, setBroken] = useState(false);
  return avatar && !broken
    ? <img className="atlas-reason-face" src={avatar} alt="" width={18} height={18} referrerPolicy="no-referrer" loading="lazy" onError={() => setBroken(true)} />
    : <span className="atlas-reason-face" aria-hidden="true">{name.charAt(0)}</span>;
}

/** Phone: why a post is in For You. "Popular in" shows the group's avatar before its name; the name opens the group. */
export function MobileReasonChips({ reasons }: { reasons?: ForYouReason[] }) {
  // Only what the reader couldn't tell already: which group made it popular. They know whom they follow, and a
  // followed hashtag shows as the post's tag line (FollowedTagLine), as Ivory does.
  const groups = (reasons ?? []).filter(r => r.kind === 'group');
  if (!groups.length) return null;
  return <p className="atlas-reasons">{groups.map((r, i) =>
    <span key={i} className="atlas-reason-group">Popular in {r.groupId
      ? <button type="button" onClick={() => openGroup({ id: r.groupId!, name: r.group, avatar: r.avatar })} aria-label={`Open ${r.group}`}><ChipGroupFace name={r.group} avatar={r.avatar} /><b>{r.group}</b></button>
      : <><ChipGroupFace name={r.group} /><b>{r.group}</b></>}</span>)}</p>;
}

/** The followed hashtags a post uses, at its top left with a tag icon and no accent colour, after Ivory. Each opens its
 *  feed. */
export function FollowedTagLine({ tags }: { tags: string[] }) {
  if (!tags.length) return null;
  return <p className="atlas-post-tagline">{tags.slice(0, 3).map(t => <button key={t} type="button" onClick={() => openTag(t)} aria-label={`Open #${t}, a hashtag you follow`}>
    <Icon ios="f7:tag" md="material:sell" />{t}
  </button>)}</p>;
}


/** Everything a feed of post cards shares: Save, Like and Boost state, and the reply sheet (render `sheet` once). */
export function useMobilePostActions() {
  const save = useSaveToggle();
  const reactions = useReactions();
  const [replying, setReplying] = useState<FedizenPost | null>(null);
  return {
    save, reactions, onReply: setReplying,
    error: save.error ?? reactions.error,
    sheet: <ReplySheet post={replying} onClose={() => setReplying(null)} />,
  };
}
export type MobileActions = ReturnType<typeof useMobilePostActions>;


/**
 * Phone: what a post says and carries, behind its content warning: text, media (behind the sensitive veil and the
 * reader's blur setting), poll, collections and link preview. Shared by feed cards and the conversation prototypes,
 * so a layout never drops content or skips a warning.
 */
export function MobilePostContent({ post: original }: { post: FedizenPost }) {
  const mine = useIsMine(original);
  // Translated in place when the person reads another language (useTranslation.tsx).
  const tr = usePostTranslation(original);
  const p = tr.shown;
  return <div ref={tr.ref} lang={tr.shownLang} className="atlas-post-content">
      <AuthorWarning cw={p.cw} article={p.longform} credits={foldCredits(p).length ? <div className="atlas-article"><AuthorRows authors={foldCredits(p)} /></div> : null} after={p.credits?.length ? <div className="atlas-article"><AuthorRows authors={p.credits} /></div> : null} phone>
    <PostBody post={p} onTag={openTag} pClassName="atlas-post-text" />
    <TranslationLineView line={tr.line} onSettings={() => pushPage('/intelligence/')} className="is-phone" />
    <SensitiveMedia sensitive={p.sensitive} cta="Tap to view">{p.video ? <VideoPlayer video={p.video} /> : p.image && <img className="atlas-post-image" src={p.image} alt="" loading="lazy" referrerPolicy="no-referrer" {...(p.imageSize ? { width: p.imageSize.w, height: p.imageSize.h, style: { aspectRatio: `${p.imageSize.w} / ${p.imageSize.h}` } } : {})} />}</SensitiveMedia>
    {p.pollState && <PollView poll={p.pollState} mine={mine} phone />}
    {p.collections?.map(link => <button key={link} type="button" className="atlas-coll-link" onClick={() => openCollection(link)}>
      <Icon ios="f7:square_stack_3d_up" md="material:collections_bookmark" /><span><b>Collection</b><small>{new URL(link).hostname}</small></span><Icon ios="f7:chevron_right" md="material:chevron_right" />
    </button>)}
    <ArticleCard article={p.article} />
    </AuthorWarning>
  </div>;
}

const cx = (...c: (string | false | undefined)[]) => c.filter(Boolean).join(' ');

/** The opened post's full date and time, and its counts, under the post (Mastodon, Bluesky). */
function MobileFocusDetails({ post: p }: { post: FedizenPost }) {
  const c = p.counts;
  const n = (v: number, one: string, many: string) => `${v.toLocaleString()} ${v === 1 ? one : many}`;
  return <div className="atlas-thread-details">
    {p.date && <p><time dateTime={p.date}>{new Date(p.date).toLocaleString(undefined, { dateStyle: 'long', timeStyle: 'short' })}</time>{p.editedAt && ' · Edited'}</p>}
    {c && (c.replies || c.boosts || c.likes) ? <p>{[n(c.replies, 'reply', 'replies'), n(c.boosts, 'boost', 'boosts'), n(c.likes, 'like', 'likes')].join(' · ')}</p> : null}
  </div>;
}

function Avatar({ post: p }: { post: FedizenPost }) {
  const face = useLiveAvatar(p.avatar, p.actor);
  return face.src
    ? <img className="atlas-post-avatar" src={face.src} alt="" width={40} height={40} referrerPolicy="no-referrer" loading="lazy" onError={face.onError} />
    : <span className="atlas-post-avatar atlas-activity-initial" aria-hidden="true">{p.author.charAt(0)}</span>;
}

/** Phone: one post in a feed — author, text, media or link preview — with the standard post actions. */
/** Phone: one post, unless the person's keyword filters hide it (or show it behind a notice, or blur its media). */
export function MobilePostCard(props: { post: FedizenPost; actions: MobileActions; reasons?: ForYouReason[]; /** The hashtag feed this card is in: no need to name that tag again. */ inTag?: string; mode?: CardMode }) {
  const deleted = useIsDeleted(props.post.statusId);
  useEffect(() => { if (!deleted) queueForIndex(props.post); }, [deleted, props.post]);
  if (deleted) return null;
  return <MobileFilterGate post={props.post}><MobilePostCardBody {...props} /></MobileFilterGate>;
}

function MobilePostCardBody({ post: p, actions, reasons, inTag, mode = 'feed' }: { post: FedizenPost; actions: MobileActions; reasons?: ForYouReason[]; /** The hashtag feed this card is in: no need to name that tag again. */ inTag?: string; mode?: CardMode }) {
  const ago = shortAgo(p.date);
  const mine = useIsMine(p);
  const tagLine = useTagLine(p, reasons).filter(t => t !== inTag);
  // Tapping the post (not a link or control in it) opens its conversation, as Mastodon, Bluesky and Phanpy do.
  const opens = mode !== 'focus' && isStatusId(p.statusId);
  // Framework7's Card doesn't take onClick; a layout-less wrapper catches the tap as it bubbles.
  return <div className="atlas-post-hit" onClick={opens ? e => { if (isPostClick(e)) openPost(p); } : undefined}>
  <Card outline className={cx('atlas-post-card', mode === 'focus' && 'atlas-thread-focus')}>
    <CardContent>
      {mode === 'feed' && <FollowedTagLine tags={tagLine} />}
      {mode === 'feed' && <MobileReasonChips reasons={reasons} />}
      <BoostedBy post={p} className="atlas-post-boosted" onTag={openTag} />
      {mode === 'feed' && p.replyTo?.post && <ReplyParent post={p.replyTo.post} onTag={openTag} Gate={({ post, children }) => <MobileFilterGate post={post} card={false}>{children}</MobileFilterGate>} />}
      <div className="atlas-post-head">
        {canOpen(p)
          ? <button type="button" className="atlas-author-button atlas-author-fill" onClick={() => openAuthor(p)} aria-label={`${p.author} ${p.handle}. Open their profile`}><Avatar post={p} /><span className="atlas-post-who"><b>{p.author}</b><small>{p.handle}</small></span></button>
          : <><Avatar post={p} /><span className="atlas-post-who"><b>{p.author}</b><small>{p.handle}</small></span></>}
        {ago && mode !== 'focus' && (opens
          ? <button type="button" className="atlas-post-time" onClick={() => openPost(p)} aria-label={`Open the conversation, posted ${p.date ? new Date(p.date).toLocaleString() : ago}${p.editedAt ? ', edited' : ''}`}>{ago}{p.editedAt && <span className="atlas-post-edited"> · Edited</span>}</button>
          : <Link external target="_blank" href={p.url} className="atlas-post-time" aria-label={`Open the post on Fedizen, posted ${p.date ? new Date(p.date).toLocaleString() : ''}${p.editedAt ? ', edited' : ''}`}>{ago}{p.editedAt && <span className="atlas-post-edited"> · Edited</span>}</Link>)}
      </div>
      <MobilePostContent post={p} />
      {mode === 'focus' && <MobileFocusDetails post={p} />}
    </CardContent>
    <CardFooter className="atlas-post-footer"><MobilePostActions post={p} save={actions.save} reactions={actions.reactions} onReply={actions.onReply} /></CardFooter>
  </Card>
  </div>;
}
