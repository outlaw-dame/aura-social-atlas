import { useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import type { FilterablePost, Verdict } from '@/lib/content-filter';
import { shortAgo } from '@/lib/feed-types';
import { usePostFilter } from './useIntelligence';

/** Why a post was filtered, in a few words: the words that matched, or the AI model that judged it in context. */
export function filterReason(v: Extract<Verdict, { state: 'filtered' }>, product: string | null): string {
  return v.reason.by === 'words' ? `matched “${v.reason.term}”` : `judged by ${product ?? 'your AI model'}`;
}

export type GateView = { kind: 'show' } | { kind: 'none' } | { kind: 'notice'; filter: string; why: string; onShow: () => void } | { kind: 'blur'; filter: string; why: string; onShow: () => void };
/** What a filtered post still shows above its notice: who posted it and when (as Bluesky clients do). */
export type GatedPost = FilterablePost & { author?: string; handle?: string; avatar?: string; date?: string };

/** The notice's one line: which filter, and why it caught the post. */
export const hiddenBy = (filter: string, why: string) =>
  why.toLowerCase() === `matched “${filter.toLowerCase()}”` ? `Hidden by your filter “${filter}”` : `Hidden by your filter “${filter}” · ${why}`;

/** An orange warning triangle, the familiar mark for hidden content (iOS and Bluesky clients use the same). */
export function WarningMark({ className = '' }: { className?: string }) {
  return <svg className={className} viewBox="0 0 24 24" width="30" height="30" aria-hidden="true">
    <path d="M10.3 3.6a2 2 0 0 1 3.4 0l8.3 14.4a2 2 0 0 1-1.7 3H3.7a2 2 0 0 1-1.7-3z" fill="#F0913A" />
    <path d="M12 8.2v5.6" stroke="#fff" strokeWidth="2.3" strokeLinecap="round" /><circle cx="12" cy="17.2" r="1.35" fill="#fff" />
  </svg>;
}

/**
 * What a post card shows under the person's filters (shared by desktop and phone):
 * - pending (being checked) and hide: nothing — except on a profile someone opened on purpose, where a hidden post
 *   shows as a notice (Bluesky blurs instead of removing when you look at a post itself);
 * - warn: "Filtered: …" with Show anyway (Mastodon);
 * - blur: the post, with its images and video hidden until shown (Mastodon 4.4's "blur").
 */
export function useFilterGate(post: GatedPost): GateView {
  const { verdict: v, place, product } = usePostFilter(post);
  const [shown, setShown] = useState(false);
  if (v.state === 'clear' || shown) return { kind: 'show' };
  if (v.state === 'pending') return { kind: 'none' };
  const why = filterReason(v, product), onShow = () => setShown(true);
  if (v.action === 'blur') return { kind: 'blur', filter: v.filter.text, why, onShow };
  if (v.action === 'hide' && place !== 'account') return { kind: 'none' };
  return { kind: 'notice', filter: v.filter.text, why, onShow };
}

/** Desktop: a post behind the person's filters. A hidden or warned post keeps its author line, and in place of its
 *  words shows a warning mark, "Content Warning", which filter hid it and why, and View post — as Bluesky clients do. */
export function FilterGate({ post, children }: { post: GatedPost; children: ReactNode }) {
  const g = useFilterGate(post);
  if (g.kind === 'show') return <>{children}</>;
  if (g.kind === 'none') return null;
  if (g.kind === 'blur') return <div className="atlas-filter-blur">
    <p className="mb-2 flex items-center gap-2 text-xs text-muted-foreground"><span className="min-w-0 flex-1 truncate">Media hidden · {g.filter}</span><Button variant="ghost" size="sm" className="h-7 rounded-full" onClick={g.onShow}>Show</Button></p>
    {children}
  </div>;
  const ago = shortAgo(post.date);
  return <article className="border-b border-border pb-4">
    {post.author && <div className="flex items-center gap-3">
      {post.avatar ? <img src={post.avatar} alt="" loading="lazy" referrerPolicy="no-referrer" className="size-10 shrink-0 atlas-avatar bg-muted object-cover ring-1 ring-border" />
        : <span aria-hidden="true" className="atlas-avatar flex size-10 shrink-0 items-center justify-center bg-muted font-serif text-base">{post.author.charAt(0)}</span>}
      <p className="min-w-0 flex-1 text-sm leading-tight"><span className="block truncate font-semibold">{post.author}</span>{post.handle && <span className="block truncate text-xs text-muted-foreground">{post.handle}</span>}</p>
      {ago && <span className="shrink-0 text-xs text-muted-foreground">{ago}</span>}
    </div>}
    <button type="button" onClick={g.onShow} className="mt-3 flex w-full flex-col items-center gap-1 rounded-2xl bg-muted/60 px-6 py-7 text-center transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      <WarningMark className="mb-1" />
      <span className="text-base font-semibold">Content Warning</span>
      <span className="text-sm text-muted-foreground">{hiddenBy(g.filter, g.why)}</span>
      <span className="mt-1 text-sm font-semibold text-accent">View post</span>
    </button>
  </article>;
}
