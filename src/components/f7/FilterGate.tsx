import type { ReactNode } from 'react';
import { Card, CardContent } from 'framework7-react';
import { MediaVeilContext } from '@/components/social/SensitiveMedia';
import { shortAgo } from '@/lib/feed-types';
import { WarningMark, hiddenBy, useFilterGate, type GatedPost } from '@/components/social/FilterGate';

/**
 * Phone: a post behind the person's filters (see useFilterGate). A hidden or warned post keeps its author line, and in
 * place of its words shows a warning mark, "Content Warning", which filter hid it and why, and Tap to view — as
 * Bluesky clients on iOS do. `card` wraps it as a feed card.
 */
export function MobileFilterGate({ post, card = true, children }: { post: GatedPost; card?: boolean; children: ReactNode }) {
  const g = useFilterGate(post);
  if (g.kind === 'none') return null;
  if (g.kind === 'show' || g.kind === 'blur') return <MediaVeilContext.Provider value={g.kind === 'blur' ? { reason: hiddenBy(g.filter, g.why), onShow: g.onShow } : null}>{children}</MediaVeilContext.Provider>;
  const ago = shortAgo(post.date);
  const body = <>
    {post.author && <div className="atlas-post-head">
      {post.avatar ? <img className="atlas-post-avatar" src={post.avatar} alt="" width={40} height={40} referrerPolicy="no-referrer" loading="lazy" />
        : <span className="atlas-post-avatar atlas-activity-initial" aria-hidden="true">{post.author.charAt(0)}</span>}
      <span className="atlas-post-who"><b>{post.author}</b>{post.handle && <small>{post.handle}</small>}</span>
      {ago && <span className="atlas-post-time">{ago}</span>}
    </div>}
    <button type="button" className="atlas-filter-warning" onClick={g.onShow}>
      <WarningMark />
      <b>Content Warning</b>
      <span>{hiddenBy(g.filter, g.why)}</span>
      <em>Tap to view</em>
    </button>
  </>;
  return card ? <Card outline className="atlas-post-card atlas-post-filtered"><CardContent>{body}</CardContent></Card> : <div className="atlas-post-filtered">{body}</div>;
}
