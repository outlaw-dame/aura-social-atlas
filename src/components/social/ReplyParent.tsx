import { useState, type ReactNode } from 'react';
import type { FedizenPost } from '@/lib/fedizen-feed';
import { shortAgo } from '@/lib/feed-types';
import { canOpen, openAuthor } from './PostPeople';
import { ProfileHoverCard } from './ProfileHoverCard';
import { PostBody } from './PostBody';

/**
 * The post a reply answers, above the reply in a feed, joined to it by a thread line (as Ivory and Phanpy show a
 * reply's context; Bonfire's own feed only says "reply in thread"). Compact: avatar, name, time, a few lines of text
 * and the first image. `Gate` applies the reader's keyword filters to it, as to any post (desktop or phone gate).
 */
export function ReplyParent({ post: p, onTag, Gate }: { post: FedizenPost; onTag: (tag: string) => void; Gate: (props: { post: FedizenPost; children: ReactNode }) => ReactNode }) {
  const [broken, setBroken] = useState(false);
  const ago = shortAgo(p.date);
  const face = p.avatar && !broken
    ? <img src={p.avatar} alt="" width={32} height={32} loading="lazy" referrerPolicy="no-referrer" onError={() => setBroken(true)} className="atlas-reply-parent-avatar atlas-avatar" />
    : <span aria-hidden="true" className="atlas-reply-parent-avatar atlas-avatar atlas-reply-parent-initial">{p.author.charAt(0)}</span>;
  const who = <>{face}<span className="atlas-reply-parent-who"><b>{p.author}</b> <span>{p.handle}</span></span></>;
  return <Gate post={p}><section className="atlas-reply-parent" aria-label={`In reply to ${p.author}`}>
    <div className="atlas-reply-parent-head">
      {canOpen(p)
        ? <ProfileHoverCard target={{ actor: p.actor, acct: p.acct, name: p.author }}><button type="button" className="atlas-author-button atlas-author-fill" onClick={() => openAuthor(p)} aria-label={`${p.author} ${p.handle}. Open their profile`}>{who}</button></ProfileHoverCard>
        : <span className="atlas-author-button atlas-author-fill">{who}</span>}
      {ago && <span className="atlas-reply-parent-time">{ago}</span>}
    </div>
    <div className="atlas-reply-parent-body">
      {p.cw ? <p className="atlas-reply-parent-cw">Content warning: {p.cw}</p>
        : <PostBody post={p} onTag={onTag} limit={4} />}
      {!p.cw && !p.sensitive && p.image && <img src={p.image} alt="" loading="lazy" referrerPolicy="no-referrer" className="atlas-reply-parent-image" />}
    </div>
  </section></Gate>;
}
