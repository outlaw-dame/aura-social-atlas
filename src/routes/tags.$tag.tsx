import { createFileRoute, Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, ArrowUpRight, Link2, MessageCircle, Repeat2, Star } from 'lucide-react';
import type { FedizenPost } from '@/lib/fedizen-feed';
import { useAtlasAuth } from '@/components/social/AuthState';
import { FEED_PROBLEM, useFollowedTags, useTagFeed } from '@/components/social/useFeeds';
import { FollowTagButton } from '@/components/social/FollowedHashtags';
import { StandaloneDesktopHosts } from '@/components/social/DesktopHosts';
import { useFedizen } from '@/components/social/useFedizen';
import { Button } from '@/components/ui/button';
import { FeedPostCard, useFeedPostActions } from '@/components/social/FeedPostCard';
import { getTagFeed } from '@/lib/tag-feed.functions';
import { linkifyHashtags } from '@/lib/hashtags';
import { NetworkBadge } from '@/lib/networks';

export const Route = createFileRoute('/tags/$tag')({
  head: ({ params }) => {
    const t = `${params.tag} — Hashtag on Atlas`;
    const d = `Public fediverse posts tagged ${params.tag}, gathered on Atlas.`;
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
  // This page renders outside Discovery, so it mounts the profile and collection dialogs, mini player and VideoDock itself.
  return <><TagBody tag={tag} /><StandaloneDesktopHosts /></>;
}

function TagBody({ tag }: { tag: string }) {
  const { user, loading } = useAtlasAuth();
  const norm = tag.replace(/^#/, '').toLowerCase();
  const fedizen = useTagFeed(user && /^[\p{L}\p{N}_]{1,100}$/u.test(norm) ? norm : null);
  // Signed in with Fedizen connected: Fedizen's feed for the tag, as the person may see and act on it — and when Fedizen
  // fails or access lapsed, that failure with its retry or reconnect, never someone else's feed in its place. Only a
  // signed-out reader, or one who hasn't connected Fedizen, gets the public posts below, from mastodon.social.
  const personal = !!user && fedizen.data?.error !== 'not-connected';
  const followed = useFollowedTags();
  if (loading || (user && fedizen.isLoading)) return <TagShell tag={tag}><p className="text-sm text-muted-foreground">Loading posts…</p></TagShell>;
  // Follow / Following sits in the header, as Mastodon offers it, once Fedizen has answered for this account.
  const action = personal && !fedizen.isError && !fedizen.data?.error ? <FollowTagButton tag={norm} following={followed.has(norm)} /> : null;
  if (personal) return <TagShell tag={tag} action={action}>
    <FedizenTagPosts posts={fedizen.data?.posts ?? []} tag={tag} failed={fedizen.isError} problem={fedizen.data?.error} retry={() => void fedizen.refetch()} />
  </TagShell>;
  return <PublicTagPage tag={tag} />;
}

function TagShell({ tag, action, children }: { tag: string; action?: React.ReactNode; children: React.ReactNode }) {
  return <main className="mx-auto min-h-dvh max-w-2xl px-4 py-6">
    <Link to="/feeds" className="mb-6 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" />Feeds</Link>
    <header className="mb-6 flex items-center justify-between gap-4 border-b border-border pb-5">
      <h1 className="font-serif text-4xl italic text-accent">{tag}</h1>
      {action}
    </header>
    {children}
  </main>;
}

function FedizenTagPosts({ posts, tag, failed, problem, retry }: { posts: FedizenPost[]; tag: string; failed: boolean; problem?: keyof typeof FEED_PROBLEM; retry: () => void }) {
  const actions = useFeedPostActions();
  if (failed || problem === 'unavailable') return <p className="text-sm text-muted-foreground">{FEED_PROBLEM.unavailable} <button type="button" className="underline" onClick={retry}>Try again</button></p>;
  if (problem) return <Reconnect message={FEED_PROBLEM[problem]} tag={tag} />;
  return <>
    {actions.error && <p role="alert" className="mb-4 text-sm text-destructive">{actions.error}</p>}
    {posts.length ? <div className="space-y-6">{posts.map(p => <FeedPostCard key={p.id} post={p} actions={actions} inTag={tag.replace(/^#/, '').toLowerCase()} />)}</div>
      : <p className="text-sm text-muted-foreground">No posts you can see are tagged {tag} yet.</p>}
    {actions.dialog}
  </>;
}

/** Access lapsed or lacks a permission: say so and offer to connect again, in place of the feed. */
function Reconnect({ message, tag }: { message: string; tag: string }) {
  const f = useFedizen();
  return <div className="text-sm text-muted-foreground"><p>{message}</p>
    {f.embedded ? <Button asChild className="mt-4"><a href={`${window.location.origin}/tags/${encodeURIComponent(tag)}`} target="_blank" rel="noopener noreferrer">Open Atlas in a new tab to connect<ArrowUpRight /></a></Button>
      : <Button className="mt-4" onClick={() => void f.connect()} disabled={f.actionBusy}><Link2 />{f.actionBusy ? 'Connecting…' : 'Connect Fedizen'}</Button>}
    {f.error && <p role="alert" className="mt-3 text-destructive">{f.error}</p>}
  </div>;
}

function PublicTagPage({ tag }: { tag: string }) {
  const { data, isLoading, error } = useQuery({ queryKey: ['tag-feed', tag], queryFn: () => getTagFeed({ data: { tag } }), staleTime: 60_000 });
  return <main className="mx-auto min-h-dvh max-w-2xl px-4 py-6">
    <Link to="/" className="mb-6 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" />Discover</Link>
    <header className="mb-6 border-b border-border pb-5">
      <h1 className="font-serif text-4xl italic text-accent">{tag}</h1>
      <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">From <NetworkBadge network="Mastodon" /> mastodon.social</p>
    </header>
    {isLoading && <p className="text-sm text-muted-foreground">Loading posts…</p>}
    {error && <p className="text-sm text-muted-foreground">This hashtag feed couldn't be loaded. Please try again shortly.</p>}
    {data && !data.length && <p className="text-sm text-muted-foreground">No public posts are tagged {tag} yet.</p>}
    <ol className="divide-y divide-border">{data?.map(p => <li key={p.id} className="py-5">
      <a href={p.author.url} target="_blank" rel="noopener noreferrer" className="mb-3 flex items-center gap-3">
        <img src={p.author.avatar} alt="" width={40} height={40} className="size-10 atlas-avatar object-cover ring-1 ring-border" loading="lazy" referrerPolicy="no-referrer" />
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
