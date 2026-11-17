import { FeedPostCard, useFeedPostActions } from './FeedPostCard';
import { useSearchPosts } from './useOwnPosts';

/**
 * Desktop: posts on Fedizen matching the search box (Mastodon v2 search, statuses), above the sample stories. Read with
 * the reader's own connection, so Fedizen decides what they may see. Shown once a search is submitted.
 */
export function PostSearchResults({ q }: { q: string }) {
  const s = useSearchPosts(q);
  const actions = useFeedPostActions();
  if (!s.available || q.trim().length < 2) return null;
  return <section aria-label={`Posts on Fedizen for ${q}`} className="mb-10">
    <h2 className="mb-4 font-serif text-2xl italic">Posts on Fedizen</h2>
    {s.related.length > 0 && <p className="-mt-2 mb-4 text-xs text-muted-foreground">Also searched, as suggested by your AI model: {s.related.map(t => `“${t}”`).join(', ')}</p>}
    {s.loading && !s.posts.length && <p className="text-sm text-muted-foreground">Searching posts…</p>}
    {s.error && <p role="alert" className="text-sm text-muted-foreground">{s.error}</p>}
    {!s.loading && !s.error && !s.posts.length && <p className="text-sm text-muted-foreground">No posts on Fedizen match “{q}”.</p>}
    <div className="space-y-4">{s.posts.map(p => <FeedPostCard key={p.id} post={p} actions={actions} />)}</div>
    {actions.error && <p role="alert" className="mt-2 text-sm text-destructive">{actions.error}</p>}
    {actions.dialog}
  </section>;
}
