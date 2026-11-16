import type { ReactNode } from 'react';
import { Card, CardContent, Link } from 'framework7-react';
import type { FilterablePost } from '@/lib/content-filter';
import { useFilterGate } from '@/components/social/FilterGate';

/** Phone: a post behind the person's filters (see useFilterGate). `card` wraps the notice as a feed card. */
export function MobileFilterGate({ post, card = true, children }: { post: FilterablePost & { handle?: string }; card?: boolean; children: ReactNode }) {
  const g = useFilterGate(post);
  if (g.kind === 'show') return <>{children}</>;
  if (g.kind === 'none') return null;
  if (g.kind === 'blur') return <div className="atlas-filter-blur">
    <div className="atlas-filter-blur-bar"><span>Media hidden · {g.filter}</span><Link onClick={g.onShow}>Show</Link></div>
    {children}
  </div>;
  const body = <div className="atlas-post-filtered-row"><span><span>Filtered: {g.filter}</span><small>{g.why}</small></span><Link onClick={g.onShow}>Show anyway</Link></div>;
  return card ? <Card outline className="atlas-post-card atlas-post-filtered"><CardContent>{body}</CardContent></Card> : <div className="atlas-post-filtered">{body}</div>;
}
