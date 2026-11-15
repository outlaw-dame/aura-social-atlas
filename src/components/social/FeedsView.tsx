import { useEffect, useState } from 'react';
import { CircleDashed, Pin, PinOff, Plus, RotateCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { circleIdOf, pinCircle, unpinCircle, usePinnedCircles, type FeedKind } from '@/lib/feed-types';
import { FedizenFeed } from './FedizenFeed';
import { PublicFedizenFeed } from './PublicFedizenFeed';
import { RecentArticles } from './RecentArticles';
import { FeedPostCard, useFeedPostActions } from './FeedPostCard';
import { FEED_PROBLEM, useCircleFeed, useFeedTabs, useForYou } from './useFeeds';
import { useFedizenCircles } from './useFedizenLibrary';
import { useAtlasAuth } from './AuthState';

const KEY = 'atlas-feed';
const remember = (k: FeedKind) => { try { sessionStorage.setItem(KEY, k); } catch { /* fine */ } };
const recall = (): FeedKind | null => { try { return sessionStorage.getItem(KEY) as FeedKind | null; } catch { return null; } };

/** Desktop Feeds page: Following, For You, Articles, Local, and the circles you've pinned, with a dot on any that has
 *  posts you haven't seen (as Particle does). */
export function FeedsView() {
  const { user } = useAtlasAuth();
  const pinned = usePinnedCircles(user?.id);
  const [feed, setFeed] = useState<FeedKind>('following');
  const [restored, setRestored] = useState(false);
  useEffect(() => { const r = recall(); if (r) setFeed(r); setRestored(true); }, []);
  const choose = (k: FeedKind) => { setFeed(k); remember(k); };
  const circleId = circleIdOf(feed);
  // A circle that was unpinned (here or on another page) falls back to Following.
  useEffect(() => { if (circleId && !pinned.some(c => c.id === circleId)) choose('following'); }, [circleId, pinned]);
  const tabs = useFeedTabs(restored ? feed : null);
  return <div>
    <div role="tablist" aria-label="Feeds" className="mb-6 flex flex-wrap items-center gap-1">
      {tabs.map(t => <button key={t.id} type="button" role="tab" aria-selected={feed === t.id} title={t.circle ? `Posts from people in ${t.label}` : t.hint} onClick={() => choose(t.id)}
        aria-label={t.isNew ? `${t.label}, new posts` : undefined}
        className={`inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-sm font-semibold transition-colors ${feed === t.id ? 'bg-foreground text-background' : 'text-foreground/80 hover:text-foreground'}`}>
        {t.isNew && <span aria-hidden="true" className="size-2 rounded-full bg-accent" />}{t.label}
      </button>)}
      {user && <PinCircleMenu />}
    </div>
    {feed === 'following' && <FedizenFeed />}
    {feed === 'foryou' && <ForYouFeed />}
    {feed === 'articles' && <RecentArticles />}
    {feed === 'local' && <PublicFedizenFeed />}
    {circleId && <CircleFeed id={circleId} title={pinned.find(c => c.id === circleId)?.title ?? 'Circle'} />}
  </div>;
}

/** Pin one of your circles to Feeds (or unpin it). */
function PinCircleMenu() {
  const { user } = useAtlasAuth();
  const [open, setOpen] = useState(false);
  const q = useFedizenCircles(open);
  const pinned = usePinnedCircles(user?.id);
  const circles = q.data?.circles ?? [];
  return <Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger asChild><Button variant="ghost" size="sm" className="rounded-full text-muted-foreground"><Plus />Circle</Button></PopoverTrigger>
    <PopoverContent align="start" className="w-72 rounded-2xl p-2">
      <p className="px-2 pb-2 pt-1 text-xs text-muted-foreground">Pin a circle to Feeds to read posts from the people in it.</p>
      {q.isLoading && <p className="px-2 py-2 text-sm text-muted-foreground">Loading your circles…</p>}
      {q.data?.error && <p className="px-2 py-2 text-sm text-muted-foreground">{FEED_PROBLEM[q.data.error]}</p>}
      {!q.isLoading && !q.data?.error && !circles.length && <p className="px-2 py-2 text-sm text-muted-foreground">You have no circles yet. Make one in Profile → Circles.</p>}
      <ul>{circles.map(c => { const on = pinned.some(p => p.id === c.id); return <li key={c.id}>
        <button type="button" onClick={() => user && (on ? unpinCircle(user.id, c.id) : pinCircle(user.id, c))} aria-pressed={on}
          className="flex w-full items-center gap-2 rounded-xl px-2 py-2 text-left text-sm hover:bg-muted">
          <CircleDashed className="size-4 text-accent" /><span className="min-w-0 flex-1 truncate">{c.title}</span>{on ? <PinOff className="size-4 text-muted-foreground" aria-label="Unpin" /> : <Pin className="size-4 text-muted-foreground" aria-label="Pin" />}
        </button></li>; })}</ul>
    </PopoverContent>
  </Popover>;
}

function Head({ title, sub }: { title: string; sub: string }) {
  return <div className="mb-5 flex items-baseline justify-between gap-4"><h2 className="font-serif text-2xl italic">{title}</h2><span className="text-right text-[10px] uppercase text-muted-foreground">{sub}</span></div>;
}

function ForYouFeed() {
  const { user } = useAtlasAuth();
  const q = useForYou(true);
  const actions = useFeedPostActions();
  const d = q.data;
  const sub = d ? [d.tags.length ? `#${d.tags.join(' #')}` : null, d.groups.length ? `${d.groups.length} group${d.groups.length === 1 ? '' : 's'}` : null].filter(Boolean).join(' · ') || 'People you follow' : '';
  return <section className="mb-12"><Head title="For You" sub={sub} />
    {!user ? <p className="text-sm text-muted-foreground">Sign in to Atlas and connect Fedizen for your For You feed.</p>
      : q.isLoading ? <p className="text-sm text-muted-foreground">Putting your feed together…</p>
      : q.isError ? <p className="text-sm text-muted-foreground">{FEED_PROBLEM.unavailable} <Button variant="link" size="sm" className="px-1" onClick={() => void q.refetch()}><RotateCw />Try again</Button></p>
      : d?.error ? <p className="text-sm text-muted-foreground">{FEED_PROBLEM[d.error]}</p>
      : <>
        {actions.error && <p role="alert" className="mb-4 text-sm text-destructive">{actions.error}</p>}
        {d && d.missing.length > 0 && <p role="status" className="mb-4 text-xs text-muted-foreground">Some of For You couldn’t load ({d.missing.map(m => (m === 'following' ? 'people you follow' : m === 'tags' ? 'followed hashtags' : 'your groups')).join(', ')}).</p>}
        <div className="space-y-6">{d?.posts.length ? d.posts.map(p => <FeedPostCard key={p.url} post={p} actions={actions} reasons={p.reasons} />)
          : <p className="text-sm text-muted-foreground">Nothing here yet. Follow people and hashtags, or join groups, and their posts will gather here.</p>}</div>
      </>}
    {actions.dialog}
  </section>;
}

function CircleFeed({ id, title }: { id: string; title: string }) {
  const { user } = useAtlasAuth();
  const q = useCircleFeed(id);
  const actions = useFeedPostActions();
  return <section className="mb-12"><Head title={title} sub="Circle" />
    {q.isLoading ? <p className="text-sm text-muted-foreground">Loading posts from {title}…</p>
      : q.isError ? <p className="text-sm text-muted-foreground">{FEED_PROBLEM.unavailable} <Button variant="link" size="sm" className="px-1" onClick={() => void q.refetch()}><RotateCw />Try again</Button></p>
      : q.data?.error ? <p className="text-sm text-muted-foreground">{FEED_PROBLEM[q.data.error]}{q.data.error === 'not-found' && user && <> <Button variant="link" size="sm" className="px-1" onClick={() => unpinCircle(user.id, id)}>Unpin it</Button></>}</p>
      : <>{actions.error && <p role="alert" className="mb-4 text-sm text-destructive">{actions.error}</p>}<div className="space-y-6">{q.data?.posts.length ? q.data.posts.map(p => <FeedPostCard key={p.id} post={p} actions={actions} />) : <p className="text-sm text-muted-foreground">No recent posts from the people in {title}.</p>}</div></>}
    {actions.dialog}
  </section>;
}
