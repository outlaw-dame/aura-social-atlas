import { useRef, useState, type ReactNode } from 'react';
import { Bookmark, Heart, MessageCircle, RefreshCw } from 'lucide-react';
import type { FedizenPost } from '@/lib/fedizen-feed';
import type { useSaveToggle } from './useFedizenLibrary';
import { compactCount, type useReactions } from './usePostActions';

type Save = ReturnType<typeof useSaveToggle>;
type Reactions = ReturnType<typeof useReactions>;

/**
 * A post's actions, the same on desktop and phone: Reply, Boost, Like and Save spread across the card's width with
 * their counts, and More at the end (Share lives there), as Bluesky and Ivory lay them out.
 *
 * Confirmation, after Phanpy (cheeaun/phanpy, src/components/status.css): each action has its own colour, the icon and
 * count take it when on, and turning it on plays a short animation — the heart bounces, the boost arrows turn, the
 * bookmark drops in. Phanpy plays it whenever a checked icon renders; here it plays only right after the tap, so
 * scrolling past posts you liked earlier doesn't set them all off. Colours: boost green and like red (the common
 * convention, also in Bluesky and Ivory), save blue (Phanpy's bookmark), defined once in styles.css.
 */
export function PostActionBar({ post: p, save, reactions, onReply, more }: { post: FedizenPost; save: Save; reactions: Reactions; onReply: (p: FedizenPost) => void; more?: ReactNode }) {
  const acts = !!p.statusId && reactions.canAct;
  const like = reactions.state(p, 'like'), boost = reactions.state(p, 'boost');
  const saved = save.isSaved(p);
  const boostable = p.visibility !== 'private' && p.visibility !== 'direct';
  // Which action was just turned on, so only that one animates.
  const [pop, setPop] = useState<'like' | 'boost' | 'save' | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const celebrate = (k: 'like' | 'boost' | 'save') => { setPop(k); if (timer.current) clearTimeout(timer.current); timer.current = setTimeout(() => setPop(null), 1200); };
  return <div className="atlas-actbar" role="group" aria-label="Post actions">
    {acts ? <>
      <button type="button" className="atlas-act" data-kind="reply" onClick={() => onReply(p)} aria-label={`Reply${p.counts?.replies ? `, ${p.counts.replies} replies` : ''}`}>
        <MessageCircle aria-hidden="true" /><span>{p.counts?.replies ? compactCount(p.counts.replies) : ''}</span>
      </button>
      <button type="button" className={`atlas-act${pop === 'boost' ? ' pop' : ''}`} data-kind="boost" aria-pressed={boost.on} disabled={boost.pending || !boostable}
        title={boostable ? undefined : 'Only public posts can be boosted'} aria-label={`${boost.on ? 'Undo boost' : 'Boost'}${boost.count ? `, ${boost.count}` : ''}`}
        onClick={() => { if (!boost.on) celebrate('boost'); void reactions.toggle(p, 'boost'); }}>
        <RefreshCw aria-hidden="true" /><span>{boost.count ? compactCount(boost.count) : ''}</span>
      </button>
      <button type="button" className={`atlas-act${pop === 'like' ? ' pop' : ''}`} data-kind="like" aria-pressed={like.on} disabled={like.pending}
        aria-label={`${like.on ? 'Unlike' : 'Like'}${like.count ? `, ${like.count}` : ''}`}
        onClick={() => { if (!like.on) celebrate('like'); void reactions.toggle(p, 'like'); }}>
        <Heart aria-hidden="true" /><span>{like.count ? compactCount(like.count) : ''}</span>
      </button>
      {save.canSave ? <button type="button" className={`atlas-act${pop === 'save' ? ' pop' : ''}`} data-kind="save" aria-pressed={saved} disabled={save.isPending(p)}
        aria-label={saved ? 'Remove from saved' : 'Save'} onClick={() => { if (!saved) celebrate('save'); void save.toggle(p); }}>
        <Bookmark aria-hidden="true" />
      </button> : <span className="atlas-act-gap" />}
    </> : <span className="atlas-act-gap" />}
    {more}
  </div>;
}
