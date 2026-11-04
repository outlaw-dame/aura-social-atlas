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

function Meta({ it }: { it: SpotlightItem }) {
  return <p className="flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground">{it.source === 'Mastodon' ? <NetworkBadge network="Mastodon" /> : <span className="font-medium text-accent">Bonfire</span>}<span className="truncate">· {it.provider}</span>{it.shares ? <span className="flex shrink-0 items-center gap-1">· <TrendingUp className="size-3" />{it.shares.toLocaleString()}</span> : null}</p>;
}

/** Apple News-style lead story: one large image, then headline and summary. */
function Lead({ it }: { it: SpotlightItem }) {
  return <article className="pb-6">
    <a href={it.url} target="_blank" rel="noopener noreferrer" className="group block">
      {it.image && <div className="mb-3 overflow-hidden rounded-2xl bg-muted"><img src={it.image} alt="" className="aspect-[16/9] w-full object-cover" /></div>}
      <Meta it={it} />
      <h3 className="mt-1.5 font-serif text-2xl leading-tight group-hover:underline sm:text-3xl">{it.title}</h3>
      {it.description && <p className="mt-2 line-clamp-3 text-[15px] leading-relaxed text-muted-foreground">{it.description}</p>}
    </a>
    <Byline it={it} />
  </article>;
}

/** Compact list row with a fixed square thumbnail so every story aligns, with or without an image. */
function Row({ it }: { it: SpotlightItem }) {
  return <article className="py-4">
    <a href={it.url} target="_blank" rel="noopener noreferrer" className="group flex gap-4">
      <div className="min-w-0 flex-1">
        <Meta it={it} />
        <h3 className="mt-1 line-clamp-3 font-serif text-lg leading-snug group-hover:underline">{it.title}</h3>
        {it.description && <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{it.description}</p>}
      </div>
      {it.image && <img src={it.image} alt="" loading="lazy" className="size-20 shrink-0 rounded-xl bg-muted object-cover sm:size-24" />}
    </a>
    <Byline it={it} />
  </article>;
}

export function Spotlight() {
  const { data, isLoading } = useQuery({ queryKey: ['spotlight'], queryFn: () => getSpotlight(), staleTime: 10 * 60_000 });
  const items = data?.items ?? [];
  return <section aria-labelledby="spotlight-heading" className="mb-12">
    <div className="mb-5 flex items-baseline justify-between"><h2 id="spotlight-heading" className="flex items-center gap-2 font-serif text-2xl italic"><Flame className="size-5 text-accent" />Spotlight</h2></div>
    {isLoading ? <p className="text-sm text-muted-foreground">Gathering what people are sharing…</p> : !items.length ? <p className="text-sm text-muted-foreground">Nothing trending right now.</p> : <>
      <div className="grid gap-x-8 lg:grid-cols-[1.4fr_1fr]">
        {items[0] && <Lead it={items[0]} />}
        <ul className="divide-y divide-border border-t border-border lg:border-t-0">{items.slice(1, 9).map(it => <li key={it.id}><Row it={it} /></li>)}</ul>
      </div>
      {data && data.bonfireCount === 0 && <p className="mt-6 text-xs text-muted-foreground">No public Fedizen articles are trending yet — new Bonfire articles will appear here as they’re shared.</p>}
    </>}
  </section>;
}
