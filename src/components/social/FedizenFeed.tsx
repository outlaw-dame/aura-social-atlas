import { Link } from '@tanstack/react-router';
import { ArrowUpRight, Bell, Link2, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { useFedizen } from './useFedizen';
import { PublicFedizenFeed } from './PublicFedizenFeed';
import { selectBonfireHome } from '@/lib/bonfire-native-presentation';
import { CollectionLinks } from './CollectionsDesktop';
import { SaveButton } from './SavedAndCircles';
import { PostArticleCard } from './ArticleAuthors';
import { VideoPlayer } from './VideoPlayer';
import { FeedPostCard, useFeedPostActions } from './FeedPostCard';
import { useRef, type CSSProperties } from 'react';
import { NewPostFaces } from './NewPostFaces';
import { newPostsLabel } from '@/lib/new-post-faces';
import { ArrowUp, Loader2 } from 'lucide-react';
import { useHomeTimeline } from './useHomeTimeline';
import { useNativeNewPosts } from './useNativeNewPosts';

const when = (d?: string) => d ? new Date(d).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';

/** Desktop: your real Fedizen home timeline and notifications, once you connect your Fedizen account. */
export function FedizenFeed() {
  const f = useFedizen();
  const actions = useFeedPostActions();
  const list = useRef<HTMLDivElement>(null);
  const restSource = !!f.data?.connected && !f.data.error && selectBonfireHome(f.data, f.native).source !== 'native';
  const tl = useHomeTimeline(f.data, restSource, list, f.updatedAt);
  const nativeSource = !!f.data?.connected && !f.data.error && selectBonfireHome(f.data, f.native).source === 'native';
  const nativeNew = useNativeNewPosts(nativeSource, nativeSource ? f.native?.posts ?? [] : [], f.refreshNative, list);
  // One pill for either source: what's new above the feed, and how to show it.
  const fresh = restSource ? { count: tl.newCount, gap: tl.gap, faces: tl.faces, reveal: tl.reveal } : nativeSource
    ? { count: nativeNew.newCount, gap: nativeNew.gap, faces: nativeNew.faces, reveal: () => void nativeNew.reveal() } : null;
  const head = <div className="mb-5 flex items-baseline justify-between"><h2 className="font-serif text-2xl italic">Your Fedizen feed</h2><span className="text-[10px] uppercase text-muted-foreground">Live</span></div>;
  if (!f.signedIn) return <><section className="mb-12">{head}<p className="text-sm text-muted-foreground">Sign in to Atlas to see your Fedizen feed. <Link to="/auth" className="text-accent underline">Sign in</Link></p></section><PublicFedizenFeed /></>;
  if (f.loading) return <section className="mb-12">{head}<p className="text-sm text-muted-foreground">Loading your Fedizen feed…</p></section>;
  if (f.queryError) return <section className="mb-12">{head}<p className="text-sm text-muted-foreground">Atlas couldn’t check your Fedizen connection. <Button variant="link" size="sm" className="px-1" onClick={f.retry}>Try again</Button></p></section>;
  if (!f.data?.connected || f.data.error === 'expired') return <><section className="mb-12 rounded-2xl border border-border p-6">{head}
    <p className="text-sm text-muted-foreground">{f.data?.error === 'expired' ? 'Fedizen ended Atlas’s access. Connect again to keep reading.' : 'Connect your Fedizen account to see your timeline and notifications here, and to join groups and follow people from Atlas.'}</p>
    {f.embedded ? <Button asChild className="mt-4"><a href={`${window.location.origin}/feeds`} target="_blank" rel="noopener noreferrer">Open Atlas in a new tab to connect<ArrowUpRight /></a></Button>
      : <Button className="mt-4" onClick={() => void f.connect()} disabled={f.actionBusy}><Link2 />{f.actionBusy ? 'Connecting…' : 'Connect Fedizen'}</Button>}
    {f.error && <p role="alert" className="mt-3 text-sm text-destructive">{f.error}</p>}
  </section><PublicFedizenFeed /></>;
  const { error } = f.data;
  const displayed = selectBonfireHome(f.data, f.native);
  const { posts, notices } = displayed;
  return <section className="mb-12">{head}
    {f.error && <p role="alert" className="mb-4 text-sm text-destructive">{f.error}</p>}
    {actions.error && <p role="alert" className="mb-4 text-sm text-destructive">{actions.error}</p>}
    {error && displayed.source !== 'native' && <p className="mb-4 text-sm text-muted-foreground">Fedizen couldn’t send your timeline right now. <Button variant="link" size="sm" className="px-1" onClick={f.retry}>Try again</Button></p>}
    <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_240px]">
      <div ref={list} className="space-y-6">
        {/* New posts wait here until asked for (Bonfire: "Show N new activities"; Mastodon: "N new items"). */}
        {fresh && fresh.count > 0 && <div className="pointer-events-none sticky top-20 z-30 -mb-2 flex justify-center">
          <button type="button" onClick={fresh.reveal} aria-label={newPostsLabel(fresh.count, fresh.gap, fresh.faces)} disabled={nativeNew.revealing} style={{ '--atlas-pill-bg': 'var(--primary)' } as CSSProperties} className="pointer-events-auto flex h-10 items-center gap-2 rounded-full bg-primary pl-3.5 pr-1.5 text-sm font-medium text-primary-foreground shadow-lg transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            {nativeNew.revealing ? <Loader2 className="size-4 animate-spin" /> : <ArrowUp className="size-4" />}{fresh.faces.length ? <NewPostFaces faces={fresh.faces} /> : <span className="pr-2">{fresh.count === 1 ? '1 new post' : `${fresh.count}${fresh.gap ? '+' : ''} new posts`}</span>}
          </button>
        </div>}
        {(restSource ? tl.posts : posts).length ? (restSource ? tl.posts : posts).map(p => <FeedPostCard key={p.id} post={p} actions={actions} />) : error && displayed.source !== 'native' ? null : <p className="text-sm text-muted-foreground">Your Fedizen timeline is empty. Follow people on Fedizen and their posts will appear here.</p>}
        {restSource && tl.hasOlder && <div ref={tl.sentinel} className="flex justify-center py-2">
          {tl.olderFailed ? <p role="status" className="text-xs text-muted-foreground">Couldn’t load older posts. <Button variant="link" size="sm" className="px-1" onClick={() => void tl.loadOlder()}>Try again</Button></p>
            : tl.loadingOlder ? <span className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="size-3.5 animate-spin" />Loading older posts…</span>
            : <Button type="button" variant="ghost" size="sm" onClick={() => void tl.loadOlder()}>Load older posts</Button>}
        </div>}
        {displayed.source === 'native' && (
          <div className="space-y-2">
            {f.moreNativeError && <p role="status" className="text-xs text-muted-foreground">
              Couldn’t load the next page. Your existing posts are unchanged.
            </p>}
            {f.hasMoreNative && <Button type="button" variant="outline" size="sm"
              disabled={f.loadingMoreNative} onClick={f.loadMoreNative}>
              {f.loadingMoreNative ? 'Loading more…' : 'Load more posts'}
            </Button>}
          </div>
        )}</div>
      <aside><h3 className="mb-3 flex items-center gap-2 text-[10px] font-semibold uppercase text-muted-foreground"><Bell className="size-3" />Activity</h3>
        {notices.length ? <ul className="space-y-3">{notices.map(n => <li key={n.id} className="flex gap-2 text-xs">{n.avatar ? <img src={n.avatar} alt="" loading="lazy" referrerPolicy="no-referrer" className="size-6 shrink-0 atlas-avatar object-cover" /> : <span aria-hidden="true" className="atlas-avatar flex size-6 shrink-0 items-center justify-center bg-muted font-serif text-[11px]">{n.author.charAt(0)}</span>}<span><span className="font-semibold">{n.author}</span> <span className="text-muted-foreground">{n.text}</span></span></li>)}</ul> : <p className="text-xs text-muted-foreground">No new activity.</p>}
        {/* As the phone: Disconnect revokes Atlas's access at Fedizen, so it asks first. */}
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="link" size="sm" className="mt-4 px-0 text-xs text-muted-foreground" disabled={f.actionBusy}>{f.actionBusy ? 'Disconnecting…' : 'Disconnect Fedizen'}</Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Disconnect Fedizen?</AlertDialogTitle>
              <AlertDialogDescription>Atlas will stop reading and acting for your Fedizen account until you connect again.</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={() => void f.disconnect()}>Disconnect</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </aside>
    </div>
    {actions.dialog}
  </section>;
}
