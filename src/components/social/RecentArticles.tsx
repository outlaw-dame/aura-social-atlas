import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { ArrowUpRight, BookOpen, Heart, MessageCircle, RefreshCw, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { getRecentArticles } from '@/lib/bonfire.functions';
import { openFediProfile } from '@/lib/fedi-profile';
import { AuthorCards } from './ArticleAuthors';
import type { BonfireArticle } from '@/lib/spotlight';

const hostOf = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return 'the web'; } };
const when = (d?: string) => d ? new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '';

/**
 * Fedizen's articles: a short preview (Discover), or the Articles feed itself (`full`), every page loaded so far
 * with a button for the next 20 (Fedizen's articles feed, paged by its cursor).
 */
export function useArticles(full: boolean) {
  const preview = useQuery({ queryKey: ['bonfire-articles'], queryFn: () => getRecentArticles(), staleTime: 5 * 60_000, enabled: !full });
  const feed = useInfiniteQuery({
    queryKey: ['bonfire-articles', 'feed'],
    queryFn: ({ pageParam }) => getRecentArticles({ data: pageParam ? { after: pageParam } : {} }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: last => (last.error ? undefined : last.next),
    staleTime: 5 * 60_000, enabled: full,
  });
  const pages = feed.data?.pages ?? [];
  const seen = new Set<string>();
  const all = full ? pages.flatMap(p => p.articles).filter(a => (seen.has(a.id) ? false : (seen.add(a.id), true))) : preview.data?.articles ?? [];
  return {
    articles: all,
    isLoading: full ? feed.isLoading : preview.isLoading,
    failed: full ? feed.isError || (pages.length === 1 && !!pages[0]!.error) : preview.isError || !!preview.data?.error,
    retry: () => (full ? feed.refetch() : preview.refetch()),
    more: full && feed.hasNextPage ? () => feed.fetchNextPage() : undefined,
    loadingMore: feed.isFetchingNextPage,
    moreFailed: full && pages.length > 1 && !!pages[pages.length - 1]!.error,
    end: full && pages.length > 0 && !feed.hasNextPage && !pages[pages.length - 1]!.error,
  };
}


export function RecentArticles({ full = false }: { full?: boolean }) {
  const a$ = useArticles(full);
  const [open, setOpen] = useState<BonfireArticle | null>(null);
  const articles = full ? a$.articles : a$.articles.slice(0, 9);
  return <section aria-labelledby="recent-articles-heading" className="mb-12">
    <div className="mb-5 flex items-baseline justify-between"><h2 id="recent-articles-heading" className="flex items-center gap-2 font-serif text-2xl italic"><BookOpen className="size-5 text-accent" />{full ? 'Articles' : 'Recent articles'}</h2><span className="text-[10px] uppercase text-muted-foreground">Live from Fedizen</span></div>
    {a$.isLoading ? <p className="text-sm text-muted-foreground">Loading articles from Fedizen…</p>
      : a$.failed ? <p className="text-sm text-muted-foreground">Fedizen couldn’t be reached right now. <Button variant="link" size="sm" className="px-1" onClick={() => a$.retry()}>Try again</Button></p>
      : !articles.length ? <p className="text-sm text-muted-foreground">Fedizen answered, but no articles have been published yet.</p>
      : <div className="grid grid-cols-[minmax(0,1fr)] gap-x-6 gap-y-7 sm:grid-cols-2 lg:grid-cols-3">{articles.map(a => <article key={a.id}>
        <button type="button" onClick={() => setOpen(a)} className="group block w-full text-left">
          {a.image && <div className="mb-3 overflow-hidden rounded-2xl"><img src={a.image} alt="" loading="lazy" className="aspect-[16/9] w-full object-cover transition-transform duration-700 group-hover:scale-[1.025]" /></div>}
          <h3 className="font-serif text-xl leading-snug group-hover:underline">{a.title}</h3>
          {a.summary && <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">{a.summary}</p>}
          <p className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">{a.avatar && <img src={a.avatar} alt="" referrerPolicy="no-referrer" loading="lazy" onError={e => { e.currentTarget.style.display = 'none'; }} className="size-5 atlas-avatar object-cover" />}<span className="truncate">{a.author}</span><span>· {when(a.date)}</span></p>
        </button>
      </article>)}</div>}
    {full && !a$.isLoading && !a$.failed && articles.length > 0 && <div className="mt-8 flex justify-center" aria-live="polite">
      {a$.more ? <Button variant="outline" className="rounded-full" disabled={a$.loadingMore} onClick={() => a$.more?.()}>{a$.loadingMore ? 'Loading…' : 'More articles'}</Button>
        : a$.moreFailed ? <p className="text-sm text-muted-foreground">Fedizen couldn’t send more articles right now. <Button variant="link" size="sm" className="px-1" onClick={() => a$.retry()}>Try again</Button></p>
        : a$.end ? <p className="text-sm text-muted-foreground">That’s every article Fedizen knows of.</p> : null}
    </div>}
    {open && <div className="social-backdrop fixed inset-0 z-[60] grid place-items-center px-4 py-6" onClick={() => setOpen(null)}>
      <section role="dialog" aria-modal="true" aria-labelledby="article-title" className="flex max-h-full w-full max-w-2xl flex-col overflow-hidden rounded-3xl border border-border bg-card text-card-foreground shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-border px-5 py-3"><p className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">{open.avatar && <img src={open.avatar} alt="" referrerPolicy="no-referrer" onError={e => { e.currentTarget.style.display = 'none'; }} className="size-6 atlas-avatar object-cover" />}<span className="truncate">{open.authorUrl ? <button type="button" onClick={() => openFediProfile({ actor: open.authorUrl, acct: open.handle, name: open.author })} className="font-semibold text-foreground hover:underline" aria-label={`More from ${open.author}`}>{open.author}</button> : <span className="font-semibold text-foreground">{open.author}</span>}{open.handle ? ` ${open.handle}` : ''} · {when(open.date)}</span></p><Button variant="ghost" size="icon" aria-label="Close article" onClick={() => setOpen(null)}><X /></Button></div>
        <div className="overflow-y-auto px-6 py-6">
          {open.image && <img src={open.image} alt="" className="mb-5 w-full rounded-2xl object-cover" />}
          <h2 id="article-title" className="font-serif text-3xl leading-tight">{open.title}</h2>
          {/* Its authors as Atlas verified them on the page it was published at (article-origins.server.ts). */}
          <AuthorCards authors={open.authors} />
          <div className="mt-5 space-y-4 text-[15px] leading-relaxed">{open.paragraphs.map((p, i) => <p key={i}>{p}</p>)}</div>
        </div>
        <div className="flex items-center justify-between border-t border-border px-5 py-3 text-xs text-muted-foreground"><span className="flex items-center gap-3"><span className="flex items-center gap-1"><Heart className="size-3.5" />{open.likes}</span><span className="flex items-center gap-1"><RefreshCw className="size-3.5" />{open.boosts}</span><span className="flex items-center gap-1"><MessageCircle className="size-3.5" />{open.replies}</span></span><Button asChild size="sm" variant="outline"><a href={open.origin ?? open.url} target="_blank" rel="noopener noreferrer">{open.origin ? `Open on ${hostOf(open.origin)}` : 'Open on Fedizen'}<ArrowUpRight /></a></Button></div>
      </section>
    </div>}
  </section>;
}
