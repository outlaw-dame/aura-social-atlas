import { useQuery } from '@tanstack/react-query';
import { Flame, TrendingUp, ExternalLink } from 'lucide-react';
import { getSpotlight } from '@/lib/spotlight.functions';
import { NetworkBadge } from '@/lib/networks';
import type { SpotlightItem } from '@/lib/spotlight';

/** Mastodon-style "More from" author attribution, improved with handle, publisher and a byline fallback. */
function Byline({ it }: { it: SpotlightItem }) {
  const acc = it.authorAccount;
  if (acc) return <a href={acc.url} target="_blank" rel="noopener noreferrer" className="mt-3 flex items-center gap-2 rounded-xl border border-border p-2 text-xs hover:bg-muted" aria-label={`More from ${acc.name} on the fediverse`}>
    {acc.avatar ? <img src={acc.avatar} alt="" width={28} height={28} className="size-7 rounded-full object-cover" loading="lazy" /> : <span className="size-7 rounded-full bg-muted" />}
    <span className="min-w-0 flex-1"><span className="block text-muted-foreground">More from</span><span className="block truncate font-medium text-foreground">{acc.name} <span className="font-normal text-muted-foreground">{acc.acct}</span></span></span>
    <ExternalLink className="size-3.5 text-muted-foreground" aria-hidden="true" />
  </a>;
  if (!it.author) return null;
  return <p className="mt-2 text-xs text-muted-foreground">By {it.authorUrl ? <a href={it.authorUrl} target="_blank" rel="noopener noreferrer" className="hover:underline">{it.author}</a> : it.author}</p>;
}

export function Spotlight() {
  const { data, isLoading } = useQuery({ queryKey: ['spotlight'], queryFn: () => getSpotlight(), staleTime: 10 * 60_000 });
  const items = data?.items ?? [];
  return <section aria-labelledby="spotlight-heading" className="mb-12">
    <div className="mb-5 flex items-baseline justify-between"><h2 id="spotlight-heading" className="flex items-center gap-2 font-serif text-2xl italic"><Flame className="size-5 text-accent" />Spotlight</h2></div>
    {isLoading ? <p className="text-sm text-muted-foreground">Gathering what people are sharing…</p> : !items.length ? <p className="text-sm text-muted-foreground">Nothing trending right now.</p> : <>
      <div className="grid gap-x-6 gap-y-8 sm:grid-cols-2 lg:grid-cols-3">{items.slice(0, 9).map((it, i) => <article key={it.id} className={i === 0 ? 'sm:col-span-2 lg:col-span-2' : ''}>
        <a href={it.url} target="_blank" rel="noopener noreferrer" className="group block">
          {it.image && <div className="overflow-hidden rounded-2xl"><img src={it.image} alt="" loading={i < 2 ? 'eager' : 'lazy'} className={`w-full object-cover transition-transform duration-700 group-hover:scale-[1.025] ${i === 0 ? 'aspect-[16/9]' : 'aspect-[4/3]'}`} /></div>}
          <p className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">{it.source === 'Mastodon' ? <NetworkBadge network="Mastodon" /> : <span className="font-medium text-accent">Bonfire</span>}<span>· {it.provider}</span>{it.shares ? <span className="flex items-center gap-1">· <TrendingUp className="size-3" />{it.shares.toLocaleString()} shares</span> : null}</p>
          <h3 className={`mt-1.5 font-serif leading-snug group-hover:underline ${i === 0 ? 'text-3xl' : 'text-xl'}`}>{it.title}</h3>
          {it.description && <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">{it.description}</p>}
        </a>
        <Byline it={it} />
      </article>)}</div>
      {data && data.bonfireCount === 0 && <p className="mt-6 text-xs text-muted-foreground">No public Fedizen articles are trending yet — new Bonfire articles will appear here as they’re shared.</p>}
    </>}
  </section>;
}
