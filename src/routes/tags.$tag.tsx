import { createFileRoute, Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Hash, MessageCircle, Repeat2, Star } from 'lucide-react';
import { getTagFeed } from '@/lib/tag-feed.functions';
import { linkifyHashtags } from '@/lib/hashtags';
import { NetworkBadge } from '@/lib/networks';

export const Route = createFileRoute('/tags/$tag')({
  head: ({ params }) => {
    const t = `#${params.tag} — Hashtag feed on Atlas`;
    const d = `Public fediverse posts that used #${params.tag}, gathered on Atlas.`;
    return { meta: [
      { title: t }, { name: 'description', content: d },
      { property: 'og:title', content: t }, { property: 'og:description', content: d },
      { property: 'og:type', content: 'website' }, { name: 'twitter:card', content: 'summary' },
    ] };
  },
  component: TagPage,
});

function TagPage() {
  const { tag } = Route.useParams();
  const { data, isLoading, error } = useQuery({ queryKey: ['tag-feed', tag], queryFn: () => getTagFeed({ data: { tag } }), staleTime: 60_000 });
  return <main className="mx-auto min-h-dvh max-w-2xl px-4 py-6">
    <Link to="/" className="mb-6 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" />Discover</Link>
    <header className="mb-6 border-b border-border pb-5">
      <h1 className="flex items-center gap-1 font-serif text-4xl italic"><Hash className="size-8 text-accent" />{tag}</h1>
      <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">Public posts known to <NetworkBadge network="Mastodon" /> mastodon.social that used this hashtag</p>
    </header>
    {isLoading && <p className="text-sm text-muted-foreground">Loading posts…</p>}
    {error && <p className="text-sm text-muted-foreground">This hashtag feed couldn't be loaded. Please try again shortly.</p>}
    {data && !data.length && <p className="text-sm text-muted-foreground">No public posts have used #{tag} yet.</p>}
    <ol className="divide-y divide-border">{data?.map(p => <li key={p.id} className="py-5">
      <a href={p.author.url} target="_blank" rel="noopener noreferrer" className="mb-3 flex items-center gap-3">
        <img src={p.author.avatar} alt="" width={40} height={40} className="size-10 rounded-full object-cover ring-1 ring-border" loading="lazy" referrerPolicy="no-referrer" />
        <span className="min-w-0"><span className="block truncate text-sm font-semibold">{p.author.name}</span><span className="block truncate text-xs text-muted-foreground">{p.author.acct}</span></span>
        <time className="ml-auto shrink-0 text-[11px] text-muted-foreground" dateTime={p.createdAt}>{new Date(p.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</time>
      </a>
      <div className="space-y-2 break-words text-sm leading-relaxed">{p.text.map((t, i) => <p key={i}>{linkifyHashtags(t)}</p>)}</div>
      {p.image && <img src={p.image} alt="" className="mt-3 max-h-96 w-full rounded-xl object-cover" loading="lazy" referrerPolicy="no-referrer" />}
      <a href={p.url} target="_blank" rel="noopener noreferrer" className="mt-3 flex gap-5 text-xs text-muted-foreground hover:text-foreground" aria-label="Open original post">
        <span className="flex items-center gap-1"><MessageCircle className="size-3.5" />{p.replies}</span>
        <span className="flex items-center gap-1"><Repeat2 className="size-3.5" />{p.boosts}</span>
        <span className="flex items-center gap-1"><Star className="size-3.5" />{p.favourites}</span>
      </a>
    </li>)}</ol>
  </main>;
}
