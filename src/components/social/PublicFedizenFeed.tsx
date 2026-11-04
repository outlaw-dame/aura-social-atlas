import { useQuery } from '@tanstack/react-query';
import { ArrowUpRight, Globe, RotateCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { getFedizenPublic } from '@/lib/bonfire.functions';
import { linkifyHashtags } from '@/lib/hashtags';

const when = (d?: string) => d ? new Date(d).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';

export const publicFeedQuery = { queryKey: ['fedizen-public'], queryFn: () => getFedizenPublic(), staleTime: 60_000 };

/** Live public posts from Fedizen members; works without signing in or connecting. */
export function PublicFedizenFeed() {
  const q = useQuery(publicFeedQuery);
  const posts = q.data?.posts ?? [];
  return <section aria-labelledby="fedizen-public-heading" className="mb-12">
    <div className="mb-5 flex items-baseline justify-between"><h2 id="fedizen-public-heading" className="flex items-center gap-2 font-serif text-2xl italic"><Globe className="size-5 text-accent" />Live on Fedizen</h2><span className="text-[10px] uppercase text-muted-foreground">Public posts</span></div>
    {q.isLoading ? <p className="text-sm text-muted-foreground">Loading public posts from Fedizen…</p>
      : q.isError || q.data?.error ? <div className="text-sm text-muted-foreground">Fedizen couldn’t be reached right now. <Button variant="link" size="sm" className="px-1" onClick={() => q.refetch()}><RotateCw />Try again</Button></div>
      : !posts.length ? <p className="text-sm text-muted-foreground">No public posts on Fedizen yet.</p>
      : <div className="space-y-6">{posts.slice(0, 10).map(p => <article key={p.id} className="border-b border-border pb-5">
        <p className="flex items-center gap-2 text-xs">{p.avatar ? <img src={p.avatar} alt="" width={32} height={32} className="size-8 rounded-full object-cover" loading="lazy" referrerPolicy="no-referrer" /> : <span className="size-8 rounded-full bg-muted" />}<span className="min-w-0"><span className="font-semibold">{p.author}</span> <span className="text-muted-foreground">{p.handle} · {when(p.date)}</span></span></p>
        <div className="mt-3 space-y-2 break-words text-sm leading-relaxed">{p.paragraphs.slice(0, 6).map((t, i) => <p key={i}>{linkifyHashtags(t)}</p>)}</div>
        {p.image && <img src={p.image} alt="" loading="lazy" referrerPolicy="no-referrer" className="mt-3 max-h-80 w-full rounded-2xl object-cover" />}
        <a href={p.url} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">Open on Fedizen<ArrowUpRight className="size-3" /></a>
      </article>)}</div>}
  </section>;
}
