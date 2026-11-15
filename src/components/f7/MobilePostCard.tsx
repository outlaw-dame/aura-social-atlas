import { useState } from 'react';
import { Card, CardContent, CardFooter, Link } from 'framework7-react';
import type { FedizenPost } from '@/lib/fedizen-feed';
import { shortAgo, type ForYouReason } from '@/lib/feed-types';
import { openCollection } from '@/lib/collections';
import { openGroup } from '@/lib/groups';
import { linkifyHashtagsWith, openTag } from '@/lib/hashtags';
import { useTagLine } from '@/components/social/useFeeds';
import { VideoPlayer } from '@/components/social/VideoPlayer';
import { useSaveToggle } from '@/components/social/useFedizenLibrary';
import { useReactions } from '@/components/social/usePostActions';
import { ArticleCard } from './ArticleAuthors';
import { MobilePostActions, ReplySheet } from './PostActions';
import { Icon } from './F7Extras';

/** A group's avatar in a reason chip: its picture, else its initial, as a rounded square (groups are squares). */
function ChipGroupFace({ name, avatar }: { name: string; avatar?: string }) {
  const [broken, setBroken] = useState(false);
  return avatar && !broken
    ? <img className="atlas-reason-face" src={avatar} alt="" width={18} height={18} referrerPolicy="no-referrer" loading="lazy" onError={() => setBroken(true)} />
    : <span className="atlas-reason-face" aria-hidden="true">{name.charAt(0)}</span>;
}

/** Phone: why a post is in For You. "Popular in" shows the group's avatar before its name; the name opens the group. */
export function MobileReasonChips({ reasons }: { reasons?: ForYouReason[] }) {
  if (!reasons?.some(r => r.kind !== 'tag')) return null;
  return <p className="atlas-reasons">{reasons.map((r, i) => r.kind === 'group'
    ? <span key={i} className="atlas-reason-group">Popular in {r.groupId
      ? <button type="button" onClick={() => openGroup({ id: r.groupId!, name: r.group, avatar: r.avatar })} aria-label={`Open ${r.group}`}><ChipGroupFace name={r.group} avatar={r.avatar} /><b>{r.group}</b></button>
      : <><ChipGroupFace name={r.group} /><b>{r.group}</b></>}</span>
    // A followed hashtag shows as the post's tag line instead (FollowedTagLine), as Ivory does.
    : r.kind === 'tag' ? null
    : <span key={i}><Icon ios="f7:person_crop_circle_badge_checkmark" md="material:how_to_reg" />You follow</span>)}</p>;
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

function Avatar({ post: p }: { post: FedizenPost }) {
  const [broken, setBroken] = useState(false);
  return p.avatar && !broken
    ? <img className="atlas-post-avatar" src={p.avatar} alt="" width={40} height={40} referrerPolicy="no-referrer" loading="lazy" onError={() => setBroken(true)} />
    : <span className="atlas-post-avatar atlas-activity-initial" aria-hidden="true">{p.author.charAt(0)}</span>;
}

/** Phone: one post in a feed — author, text, media or link preview — with the standard post actions. */
export function MobilePostCard({ post: p, actions, reasons, inTag }: { post: FedizenPost; actions: MobileActions; reasons?: ForYouReason[]; /** The hashtag feed this card is in: no need to name that tag again. */ inTag?: string }) {
  const ago = shortAgo(p.date);
  const tagLine = useTagLine(p, reasons).filter(t => t !== inTag);
  return <Card outline className="atlas-post-card">
    <CardContent>
      <FollowedTagLine tags={tagLine} />
      <MobileReasonChips reasons={reasons} />
      {p.boostedBy && <p className="atlas-post-boosted"><Icon ios="f7:arrow_2_squarepath" md="material:repeat" />{p.boostedBy} boosted</p>}
      <div className="atlas-post-head">
        <Avatar post={p} />
        <span className="atlas-post-who"><b>{p.author}</b><small>{p.handle}</small></span>
        {ago && <Link external target="_blank" href={p.url} className="atlas-post-time" aria-label={`Open the post on Fedizen, posted ${p.date ? new Date(p.date).toLocaleString() : ''}`}>{ago}</Link>}
      </div>
      {p.paragraphs.map((t, i) => <p key={i} className="atlas-post-text">{linkifyHashtagsWith(t, openTag)}</p>)}
      {p.video ? <VideoPlayer video={p.video} /> : p.image && <img className="atlas-post-image" src={p.image} alt="" loading="lazy" referrerPolicy="no-referrer" />}
      {p.collections?.map(link => <button key={link} type="button" className="atlas-coll-link" onClick={() => openCollection(link)}>
        <Icon ios="f7:square_stack_3d_up" md="material:collections_bookmark" /><span><b>Collection</b><small>{new URL(link).hostname}</small></span><Icon ios="f7:chevron_right" md="material:chevron_right" />
      </button>)}
      <ArticleCard article={p.article} />
    </CardContent>
    <CardFooter className="atlas-post-footer"><MobilePostActions post={p} save={actions.save} reactions={actions.reactions} onReply={actions.onReply} /></CardFooter>
  </Card>;
}
