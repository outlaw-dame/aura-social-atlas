import { useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import type { FilterablePost, Verdict } from '@/lib/content-filter';
import { usePostFilter } from './useIntelligence';

/** Why a post was filtered, in a few words: the words that matched, or the AI model that judged it in context. */
export function filterReason(v: Extract<Verdict, { state: 'filtered' }>, product: string | null): string {
  return v.reason.by === 'words' ? `matched “${v.reason.term}”` : `judged by ${product ?? 'your AI model'}`;
}

export type GateView = { kind: 'show' } | { kind: 'none' } | { kind: 'notice'; filter: string; why: string; onShow: () => void } | { kind: 'blur'; filter: string; why: string; onShow: () => void };

/**
 * What a post card shows under the person's filters (shared by desktop and phone):
 * - pending (being checked) and hide: nothing — except on a profile someone opened on purpose, where a hidden post
 *   shows as a notice (Bluesky blurs instead of removing when you look at a post itself);
 * - warn: "Filtered: …" with Show anyway (Mastodon);
 * - blur: the post, with its images and video hidden until shown (Mastodon 4.4's "blur").
 */
export function useFilterGate(post: FilterablePost & { handle?: string }): GateView {
  const { verdict: v, place, product } = usePostFilter(post);
  const [shown, setShown] = useState(false);
  if (v.state === 'clear' || shown) return { kind: 'show' };
  if (v.state === 'pending') return { kind: 'none' };
  const why = filterReason(v, product), onShow = () => setShown(true);
  if (v.action === 'blur') return { kind: 'blur', filter: v.filter.text, why, onShow };
  if (v.action === 'hide' && place !== 'account') return { kind: 'none' };
  return { kind: 'notice', filter: v.filter.text, why, onShow };
}

/** Desktop: a post behind the person's filters. */
export function FilterGate({ post, children }: { post: FilterablePost & { handle?: string }; children: ReactNode }) {
  const g = useFilterGate(post);
  if (g.kind === 'show') return <>{children}</>;
  if (g.kind === 'none') return null;
  if (g.kind === 'blur') return <div className="atlas-filter-blur">
    <p className="mb-2 flex items-center gap-2 text-xs text-muted-foreground"><span className="min-w-0 flex-1 truncate">Media hidden · Filtered: {g.filter} · {g.why}</span><Button variant="ghost" size="sm" className="h-7 rounded-full" onClick={g.onShow}>Show</Button></p>
    {children}
  </div>;
  return <div className="flex items-center gap-3 border-b border-border pb-4 text-sm text-muted-foreground">
    <span className="min-w-0 flex-1"><span className="block truncate">Filtered: {g.filter}</span><span className="block truncate text-xs">{g.why}</span></span>
    <Button variant="ghost" size="sm" className="rounded-full" onClick={g.onShow}>Show anyway</Button>
  </div>;
}
