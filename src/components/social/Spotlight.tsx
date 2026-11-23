import { useRef } from 'react';
import { Flame, TrendingUp, ExternalLink, ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { NetworkBadge } from '@/lib/networks';
import type { SpotlightItem } from '@/lib/spotlight';
import { useCuratedSpotlight } from './useCuratedSpotlight';
import { AuthorCards } from './ArticleAuthors';

/** Spotlight's "More from" cards (shared with feed posts). */
function Byline({ it }: { it: SpotlightItem }) {
  const authors = it.authorAccounts?.length ? it.authorAccounts : it.authorAccount ? [it.authorAccount] : [];
  return <AuthorCards authors={authors} byline={it.author} bylineUrl={it.authorUrl} />;
}

function Meta({ it }: { it: SpotlightItem }) {
  const reason = it.reason === 'trending' ? 'Trending' : 'Recent';
  const kind = it.kind === 'podcast' ? 'Podcast' : it.kind === 'video' ? 'Video' : it.kind === 'article' ? 'Article' : 'Link';
  return <p className="flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground">{it.source === 'Mastodon' ? <NetworkBadge network="Mastodon" /> : <span className="font-medium text-accent">Fedizen</span>}<span className="truncate">· {reason} {kind} · {it.provider}</span>{it.shares ? <span className="flex shrink-0 items-center gap-1" title="Source-reported link references, not unique people">· <TrendingUp className="size-3" />{it.shares.toLocaleString()} references</span> : null}</p>;
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

/** Primary feature carousel, styled like the creator story cards: large image with a label pill. */
function Carousel({ items }: { items: SpotlightItem[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const page = (dir: number) => { const el = ref.current; if (el) el.scrollBy({ left: dir * el.clientWidth * 0.85, behavior: 'smooth' }); };
  return <div className="relative min-w-0 w-full overflow-hidden" aria-roledescription="carousel" aria-label="Featured stories">
    <div ref={ref} className="flex w-full snap-x snap-mandatory gap-5 overflow-x-auto pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {items.map((it, i) => <article key={it.id} aria-roledescription="slide" aria-label={`${i + 1} of ${items.length}`} className="w-[85%] shrink-0 snap-start sm:w-[70%] lg:w-[60%]">
        <a href={it.url} target="_blank" rel="noopener noreferrer" className="group relative block overflow-hidden rounded-2xl bg-muted">
          <img src={it.image} alt="" loading={i === 0 ? 'eager' : 'lazy'} className="aspect-[16/10] w-full object-cover transition-transform duration-700 group-hover:scale-[1.025]" />
          <span className="social-image-label absolute bottom-4 left-4 rounded-full px-3 py-1 text-[10px] font-medium">{it.reason === 'trending' ? 'Trending' : 'Recent'} {it.kind === 'podcast' ? 'Podcast' : it.kind === 'video' ? 'Video' : it.kind === 'article' ? 'Article' : 'Link'} · {it.provider}</span>
        </a>
        <div className="mt-3"><Meta it={it} /></div>
        <h3 className="mt-1.5 line-clamp-3 font-serif text-2xl leading-tight"><a href={it.url} target="_blank" rel="noopener noreferrer" className="hover:underline">{it.title}</a></h3>
        {it.description && <p className="mt-2 line-clamp-2 text-sm leading-relaxed text-muted-foreground">{it.description}</p>}
        <Byline it={it} />
      </article>)}
    </div>
    {items.length > 1 && <div className="mt-3 hidden justify-end gap-2 sm:flex">
      <Button variant="outline" size="icon" className="size-8 rounded-full" aria-label="Previous story" onClick={() => page(-1)}><ChevronLeft /></Button>
      <Button variant="outline" size="icon" className="size-8 rounded-full" aria-label="Next story" onClick={() => page(1)}><ChevronRight /></Button>
    </div>}
  </div>;
}

export function Spotlight() {
  const { items, loading: isLoading, unavailable, checking, screeningUnavailable } = useCuratedSpotlight();
  return <section aria-labelledby="spotlight-heading" className="mb-12 min-w-0 max-w-full">
    <div className="mb-5 flex items-baseline justify-between"><h2 id="spotlight-heading" className="flex items-center gap-2 font-serif text-2xl italic"><Flame className="size-5 text-accent" />Spotlight</h2></div>
    {isLoading ? <p role="status" className="text-sm text-muted-foreground">Finding public stories and verifying your moderation settings…</p>
      : unavailable ? <p role="status" className="text-sm text-muted-foreground">Spotlight is paused until your account's moderation settings are available.</p>
      : screeningUnavailable ? <p role="status" className="text-sm text-muted-foreground">Spotlight cannot verify all of your keyword or semantic filters right now. Your preferences remain enforced; check Settings → Intelligence and Moderation.</p>
      : checking ? <p role="status" className="text-sm text-muted-foreground">Checking eligible stories against your keyword and semantic preferences…</p>
      : !items.length ? <p role="status" className="text-sm text-muted-foreground">No eligible public stories were found in the available sources after applying your settings.</p> : <>
      {(() => {
        const featured = items.filter(it => it.image).slice(0, 5);
        const ids = new Set(featured.map(f => f.id));
        const rest = items.filter(it => !ids.has(it.id)).slice(0, 8);
        return <>
          {featured.length > 0 && <Carousel items={featured} />}
          {rest.length > 0 && <ul className="mt-6 divide-y divide-border border-t border-border">{rest.map(it => <li key={it.id}><Row it={it} /></li>)}</ul>}
        </>;
      })()}

    </>}
  </section>;
}
