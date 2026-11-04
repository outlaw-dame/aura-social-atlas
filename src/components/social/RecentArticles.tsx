import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { ArrowUpRight, BookOpen, Heart, MessageCircle, Repeat2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { getRecentArticles } from '@/lib/bonfire.functions';
import type { BonfireArticle } from '@/lib/spotlight';

const when = (d?: string) => d ? new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '';

export function RecentArticles() {
  const { data, isLoading } = useQuery({ queryKey: ['bonfire-articles'], queryFn: () => getRecentArticles(), staleTime: 5 * 60_000 });
  const [open, setOpen] = useState<BonfireArticle | null>(null);
  const articles = data?.articles ?? [];
  return <section aria-labelledby="recent-articles-heading" className="mb-12">
    <div className="mb-5 flex items-baseline justify-between"><h2 id="recent-articles-heading" className="flex items-center gap-2 font-serif text-2xl italic"><BookOpen className="size-5 text-accent" />Recent articles</h2><span className="text-[10px] uppercase text-muted-foreground">Live from Fedizen</span></div>
    {isLoading ? <p className="text-sm text-muted-foreground">Loading articles from Fedizen…</p>
      : data?.error ? <p className="text-sm text-muted-foreground">Fedizen couldn’t be reached right now. Try again in a moment.</p>
      : !articles.length ? <p className="text-sm text-muted-foreground">No articles have been published on Fedizen yet.</p>
      : <div className="grid gap-x-6 gap-y-7 sm:grid-cols-2 lg:grid-cols-3">{articles.slice(0, 9).map(a => <article key={a.id}>
        <button type="button" onClick={() => setOpen(a)} className="group block w-full text-left">
          {a.image && <div className="mb-3 overflow-hidden rounded-2xl"><img src={a.image} alt="" loading="lazy" className="aspect-[16/9] w-full object-cover transition-transform duration-700 group-hover:scale-[1.025]" /></div>}
          <h3 className="font-serif text-xl leading-snug group-hover:underline">{a.title}</h3>
          {a.summary && <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">{a.summary}</p>}
          <p className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">{a.avatar && <img src={a.avatar} alt="" className="size-5 rounded-full object-cover" />}<span className="truncate">{a.author}</span><span>· {when(a.date)}</span></p>
        </button>
      </article>)}</div>}
    {open && <div className="social-backdrop fixed inset-0 z-[60] grid place-items-center px-4 py-6" onClick={() => setOpen(null)}>
      <section role="dialog" aria-modal="true" aria-labelledby="article-title" className="flex max-h-full w-full max-w-2xl flex-col overflow-hidden rounded-3xl border border-border bg-card text-card-foreground shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-border px-5 py-3"><p className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">{open.avatar && <img src={open.avatar} alt="" className="size-6 rounded-full object-cover" />}<span className="truncate"><span className="font-semibold text-foreground">{open.author}</span>{open.handle ? ` ${open.handle}` : ''} · {when(open.date)}</span></p><Button variant="ghost" size="icon" aria-label="Close article" onClick={() => setOpen(null)}><X /></Button></div>
        <div className="overflow-y-auto px-6 py-6">
          {open.image && <img src={open.image} alt="" className="mb-5 w-full rounded-2xl object-cover" />}
          <h2 id="article-title" className="font-serif text-3xl leading-tight">{open.title}</h2>
          <div className="mt-5 space-y-4 text-[15px] leading-relaxed">{open.paragraphs.map((p, i) => <p key={i}>{p}</p>)}</div>
        </div>
        <div className="flex items-center justify-between border-t border-border px-5 py-3 text-xs text-muted-foreground"><span className="flex items-center gap-3"><span className="flex items-center gap-1"><Heart className="size-3.5" />{open.likes}</span><span className="flex items-center gap-1"><Repeat2 className="size-3.5" />{open.boosts}</span><span className="flex items-center gap-1"><MessageCircle className="size-3.5" />{open.replies}</span></span><Button asChild size="sm" variant="outline"><a href={open.url} target="_blank" rel="noopener noreferrer">Open on Fedizen<ArrowUpRight /></a></Button></div>
      </section>
    </div>}
  </section>;
}
