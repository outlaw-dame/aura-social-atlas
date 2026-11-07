import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { ArrowUpRight, Bell, Bookmark, Check, CircleUserRound, Compass, Copy, Layers, Menu, PenLine, Plus, Rss, Search, Settings, Sparkles, Users, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { creators, fullHandle, matchesCreator, networks, podcastFeatureLabels, posts, topics, type Creator } from '@/lib/social-catalogue';
import { NetworkBadge, networkBrands } from '@/lib/networks';
import { useSocial } from './SocialState';
import { avatarPreset } from '@/lib/atlas-avatars';
import { linkifyHashtagsWith, hashtagUrl } from '@/lib/hashtags';
import { Composer } from './Composer';
import { Preferences } from './Preferences';
import { AccountButton } from './AccountButton';
import { CreatorTag } from './CreatorTag';
import { Spotlight } from './Spotlight';
import { RecentArticles } from './RecentArticles';
import { FedizenFeed } from './FedizenFeed';
import { GatewayDiscovery } from './GatewayDiscovery';
import { VoicesToKnow } from './VoicesToKnow';
import { ProfilePage } from './ProfilePage';
import type { ProfileSection } from './profile-sections';
import { ActivityPage } from './ActivityPage';
import { useAtlasAuth } from './AuthState';
import { defaultAvatarKey } from '@/lib/atlas-avatars';

export type DiscoveryView = 'feeds' | 'discover' | 'groups' | 'activity' | 'profile' | 'settings' | 'intelligence' | 'appearance';

/** The desktop page. Its navigation matches the phone app's dock: Feeds, Discover, Groups, Activity, your
 *  profile (Saved is a tab there; follows open from its Following count), then Settings. */
export function Discovery({ view = 'discover', profileSection }: { view?: DiscoveryView; profileSection?: ProfileSection }) {
  const state = useSocial();
  const auth = useAtlasAuth();
  const [query, setQuery] = useState('');
  const [submitted, setSubmitted] = useState('');
  const [network, setNetwork] = useState('All networks');
  const [topic, setTopic] = useState('All topics');
  const [mobileOpen, setMobileOpen] = useState(false);
  const [creatorDialog, setCreatorDialog] = useState<Creator | null>(null);
  const [tagFilter, setTagFilter] = useState<{ creatorId: string; tag: string } | null>(null);
  const [headerCompose, setHeaderCompose] = useState(false);
  const [headerDraft, setHeaderDraft] = useState('');
  const [headerCopied, setHeaderCopied] = useState(false);
  const matching = creators.filter(c => matchesCreator(c, submitted, network, topic));
  const feed = posts.filter(p => matching.some(c => c.id === p.creatorId) && (view !== 'feeds' || state.followed.includes(p.creatorId)) && (!tagFilter || (p.creatorId === tagFilter.creatorId && p.tags.includes(tagFilter.tag))));
  const tagFilterCreator = tagFilter ? creators.find(c => c.id === tagFilter.creatorId) : null;
  const searchActive = !!submitted || network !== 'All networks' || topic !== 'All topics';
  const title = view === 'feeds' ? 'Your corner of the web.' : 'A world of independent voices.';
  const nav = [
    { to: '/feeds' as const, label: 'Feeds', icon: Layers, key: 'feeds' },
    { to: '/' as const, label: 'Discover', icon: Compass, key: 'discover' },
    { to: '/groups' as const, label: 'Groups', icon: Users, key: 'groups' },
    { to: '/activity' as const, label: 'Activity', icon: Bell, key: 'activity' },
    { to: '/profile' as const, label: 'Profile', icon: CircleUserRound, key: 'profile' },
    { to: '/settings' as const, label: 'Settings', icon: Settings, key: 'settings' },
  ];
  const me = auth.user ? avatarPreset(auth.profile?.avatar_key ?? defaultAvatarKey(auth.user.id)) : null;
  const pageView = view === 'groups' || view === 'activity' || view === 'profile';
  const pageTitles = { groups: ['Your communities', 'Groups'], activity: ['What’s new for you', 'Activity'], profile: ['', ''] } as const;
  const settingsView = view === 'settings' || view === 'intelligence' || view === 'appearance';
  const toggleTopic = (value: string) => { setTopic(value); setMobileOpen(false); };
  return <div className={state.dark ? 'dark' : ''}><div className="social-app min-h-screen bg-background text-foreground">
    {mobileOpen && <Button variant="ghost" aria-label="Close navigation" onClick={() => setMobileOpen(false)} className="social-backdrop fixed inset-0 z-30 h-auto rounded-none lg:hidden" />}
    <aside className={`social-sidebar liquid-glass specular fixed inset-y-3 left-3 z-40 flex w-60 flex-col rounded-3xl border border-border p-5 transition-transform lg:translate-x-0 ${mobileOpen ? 'translate-x-0' : '-translate-x-[110%]'}`}>
      <div className="mb-9 flex items-center justify-between"><Link to="/" className="flex items-center gap-2 font-serif text-3xl italic"><Compass className="size-6 text-accent" strokeWidth={1.5} />Atlas</Link><Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setMobileOpen(false)} aria-label="Close menu"><X /></Button></div>
      <p className="mb-3 text-[10px] font-semibold uppercase text-muted-foreground">Your open web</p>
      <nav aria-label="Main navigation" className="space-y-1">{nav.map(item => <Button asChild variant="ghost" key={item.key} className={`h-11 w-full justify-start rounded-xl ${(view === item.key || (item.key === 'settings' && settingsView)) ? 'social-selected' : 'text-muted-foreground'}`}><Link to={item.to} onClick={() => setMobileOpen(false)} aria-current={(view === item.key || (item.key === 'settings' && settingsView)) ? 'page' : undefined}>{item.key === 'profile' && me ? <img src={me.src} alt="" className="social-avatar size-5 object-cover" /> : <item.icon />}{item.label}</Link></Button>)}</nav>
      <div className="mt-8 border-t border-border pt-5"><p className="mb-3 text-[10px] font-semibold uppercase text-muted-foreground">Explore topics</p>{topics.slice(1).map(t => <Button key={t} variant="ghost" onClick={() => toggleTopic(t)} className={`mb-1 h-9 w-full justify-start text-sm ${topic === t ? 'text-accent' : 'text-muted-foreground'}`}><span className="social-topic-dot" />{t}</Button>)}</div>
      <div className="mt-7"><p className="mb-3 text-[10px] font-semibold uppercase text-muted-foreground">Your voices</p>{state.followed.length === 0 ? <p className="text-xs leading-relaxed text-muted-foreground">No voices followed yet.</p> : creators.filter(c => state.followed.includes(c.id)).map(c => <Button variant="ghost" key={c.id} onClick={() => setCreatorDialog(c)} className="mb-2 h-auto w-full justify-start whitespace-normal px-0 text-left text-xs"><img className="social-avatar size-7 shrink-0" src={avatarPreset(c.avatar_key).src} alt="" /><span>{c.name}</span></Button>)}</div>
      <div className="mt-auto border-t border-border pt-4"><span className="flex items-center gap-2 text-xs text-muted-foreground"><Rss className="size-3" />Open web. Human voices.</span><span className="mt-2 block text-[10px] text-muted-foreground">Sample edition · session-only selections</span></div>
    </aside>
    <div className="lg:pl-[16.5rem]">
      <header className="social-header sticky top-0 z-20 flex h-16 items-center gap-2 px-5 sm:gap-3 sm:px-9">
        <Button variant="ghost" size="icon" className="liquid-glass specular shrink-0 rounded-full lg:hidden" aria-label="Open navigation" onClick={() => setMobileOpen(true)}><Menu /></Button>
        <form role="search" onSubmit={e => { e.preventDefault(); setSubmitted(query.trim()); }} className="liquid-glass specular flex h-9 min-w-0 flex-1 items-center gap-2 rounded-full border border-border px-3">
          <Search className="size-3.5 shrink-0 text-muted-foreground" /><label htmlFor="social-search" className="sr-only">Search creators and topics</label><input id="social-search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search voices, ideas, and interests…" className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground" />
          {(query || submitted) && <Button type="button" variant="ghost" size="icon" className="size-6" aria-label="Clear search" onClick={() => { setQuery(''); setSubmitted(''); }}><X /></Button>}
          <Button variant="ghost" type="submit" size="icon" className="size-6" aria-label="Search"><ArrowUpRight /></Button>
        </form>
        <div className="relative hidden sm:block">
          <Button variant="ghost" size="icon" className="liquid-glass specular rounded-full" aria-label="Open composer" aria-expanded={headerCompose} title="Compose" onClick={() => setHeaderCompose(v => !v)}><PenLine /></Button>
          {headerCompose && <section role="dialog" aria-label="Compose" className="absolute right-0 top-12 z-50 w-80 overflow-hidden rounded-2xl border border-border bg-card text-card-foreground shadow-2xl">
            <div className="flex items-center justify-between border-b border-border px-4 py-3"><h2 className="flex items-center gap-2 text-sm font-semibold"><PenLine className="size-4" />Compose</h2><Button variant="ghost" size="icon" aria-label="Close composer" onClick={() => setHeaderCompose(false)}><X /></Button></div>
            <div className="p-4"><label htmlFor="header-compose-draft" className="sr-only">Your draft</label><textarea id="header-compose-draft" value={headerDraft} onChange={e => { setHeaderDraft(e.target.value); setHeaderCopied(false); }} placeholder="What’s on your mind?" className="h-32 w-full resize-none bg-transparent text-sm leading-relaxed outline-none placeholder:text-muted-foreground" /><p className="text-xs text-muted-foreground">Draft only · no social account connected</p></div>
            <div className="flex items-center justify-end border-t border-border p-3"><Button size="sm" disabled={!headerDraft.trim()} onClick={async () => { try { await navigator.clipboard.writeText(headerDraft); setHeaderCopied(true); } catch { /* clipboard unavailable */ } }}>{headerCopied ? <Check /> : <Copy />}{headerCopied ? 'Copied' : 'Copy draft'}</Button></div>
          </section>}
        </div>
        <Button asChild variant="ghost" size="icon" className="liquid-glass specular shrink-0 rounded-full sm:hidden" aria-label="Activity and notifications" title="Activity"><Link to="/activity"><Bell /></Link></Button>
        <AccountButton />
      </header>
      <main className="mx-auto max-w-[1400px] px-5 pb-28 pt-7 sm:px-9">
        {settingsView ? <Preferences page={view === 'intelligence' ? 'intelligence' : view === 'appearance' ? 'appearance' : 'settings'} /> : view === 'profile' ? <div className="mx-auto max-w-4xl"><ProfilePage initialSection={profileSection} onOpenCreator={setCreatorDialog} /></div> : pageView ? <div className="mx-auto max-w-3xl">
          <div className="mb-8 animate-float-up"><p className="mb-3 flex items-center gap-2 text-[10px] font-semibold uppercase text-muted-foreground"><span className="social-status-dot" />{pageTitles[view][0]}</p><h1 className="font-serif text-4xl leading-tight sm:text-5xl">{pageTitles[view][1]}</h1></div>
          {view === 'activity' ? <ActivityPage /> : <div className="py-16 text-center"><Users className="mx-auto mb-4 size-8 text-muted-foreground" strokeWidth={1.5} /><h2 className="font-serif text-2xl">No groups yet.</h2><p className="mx-auto mt-3 max-w-xs text-sm text-muted-foreground">Groups you join on Fedizen and other open networks will appear here.</p><Button asChild variant="outline" className="mt-5"><Link to="/">Explore Discover<ArrowUpRight /></Link></Button></div>}
        </div> : <>
        <div className="mb-8 animate-float-up"><p className="mb-3 flex items-center gap-2 text-[10px] font-semibold uppercase text-muted-foreground"><span className="social-status-dot" />{view === 'discover' ? 'Discover the open social web' : 'A feed of your own'}</p><h1 className="font-serif text-4xl leading-tight sm:text-5xl">{title}</h1><p className="mt-3 text-sm text-muted-foreground">{view === 'discover' ? 'Find creators, fresh perspectives, and conversations beyond your usual circle.' : 'The latest from the voices you choose.'}</p></div>
        <div className="mb-8 flex flex-wrap items-center justify-between gap-4 border-b border-border pb-5">
          <div className="flex flex-wrap gap-1" aria-label="Filter by network">{networks.map(n => <Button key={n} variant="ghost" size="sm" onClick={() => setNetwork(n)} aria-pressed={network === n} className={`rounded-full ${network === n ? 'social-selected' : 'text-muted-foreground'}`}>{n === 'RSS' && <Rss className="size-3" />}{n}</Button>)}</div>
          <label className="flex items-center gap-2 text-xs text-muted-foreground">Topic<select aria-label="Filter by topic" value={topic} onChange={e => setTopic(e.target.value)} className="rounded-lg border border-border bg-background px-2 py-2 text-foreground">{topics.map(t => <option key={t}>{t}</option>)}</select></label>
        </div>
        {searchActive && <div role="status" className="mb-6 flex flex-wrap items-center gap-3 text-sm"><span>{feed.length} stories{submitted ? ` for “${submitted}”` : ''}</span><Button size="sm" variant="link" onClick={() => { setQuery(''); setSubmitted(''); setNetwork('All networks'); setTopic('All topics'); setTagFilter(null); }}>Reset filters</Button></div>}
        {tagFilter && tagFilterCreator && <div role="status" className="mb-6 flex flex-wrap items-center gap-3 text-sm"><span>Stories tagged <span className="atlas-hashtag">#{tagFilter.tag}</span> by {tagFilterCreator.name}</span><Button size="sm" variant="link" onClick={() => setTagFilter(null)}>Show everything</Button></div>}
        <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-10 xl:grid-cols-[minmax(0,1fr)_260px]">
          <section aria-label="Stories">
            {view === 'discover' && !searchActive && !tagFilter && <GatewayDiscovery />}{view === 'feeds' && !searchActive && !tagFilter && <FedizenFeed />}{view === 'discover' && !searchActive && !tagFilter && <><Spotlight /><RecentArticles /></>}
            <div className="mb-5 flex items-baseline justify-between"><h2 className="font-serif text-2xl italic">{view === 'discover' ? searchActive ? 'From the community' : 'From our creators' : 'From voices you follow'}</h2><span className="text-[10px] uppercase text-muted-foreground">Sample stories</span></div>
            {feed.length ? <div className="grid gap-x-6 gap-y-9 sm:grid-cols-2">{feed.map((p, i) => {
              const creator = creators.find(c => c.id === p.creatorId);
              if (!creator) return null;
              return <article key={p.id} className={view === 'discover' && !searchActive && i === 0 ? 'sm:col-span-2' : ''}>
                <a href={p.url} target="_blank" rel="noreferrer" className="group relative block overflow-hidden rounded-2xl"><img src={p.image} alt={p.alt} className={`w-full object-cover transition-transform duration-700 group-hover:scale-[1.025] ${i === 0 && view === 'discover' && !searchActive ? 'aspect-[16/9]' : 'aspect-[4/3]'}`} loading={i === 0 ? 'eager' : 'lazy'} /><span className="social-image-label absolute bottom-4 left-4 rounded-full px-3 py-1 text-[10px] font-medium">{creator.topic} · {p.kind}</span></a>
                <div className="mt-3 flex justify-end"><Button variant="ghost" size="icon" className="size-8 shrink-0" aria-label={!state.canSave ? `Sign in to save ${p.title}` : state.saved.includes(p.id) ? `Unsave ${p.title}` : `Save ${p.title}`} aria-pressed={state.saved.includes(p.id)} title={state.canSave ? 'Save story' : 'Sign in to save'} onClick={() => (state.canSave ? state.toggleSave(p.id) : window.location.assign('/auth'))}><Bookmark className={state.saved.includes(p.id) ? 'fill-accent text-accent' : 'text-muted-foreground'} /></Button></div>
                <h3 className={`mt-3 font-serif leading-tight ${i === 0 && view === 'discover' && !searchActive ? 'text-3xl' : 'text-2xl'}`}><a href={p.url} target="_blank" rel="noreferrer">{p.title}</a></h3><p className="mt-2 text-sm leading-relaxed text-muted-foreground">{p.excerpt}</p>
                <div className="atlas-story-tags">{p.tags.map(tag => <Button key={tag} variant="link" className="atlas-hashtag h-auto p-0 text-xs" onClick={() => setTagFilter({ creatorId: creator.id, tag })}>#{tag}</Button>)}</div>
                <CreatorTag creator={creator} onOpen={() => setCreatorDialog(creator)} />
              </article>;
            })}</div> : <div className="py-16 text-center"><Compass className="mx-auto mb-4 size-8 text-muted-foreground" /><h3 className="font-serif text-2xl">{searchActive ? 'No matches this time.' : 'Find your people.'}</h3><p className="mx-auto mt-3 max-w-xs text-sm text-muted-foreground">{searchActive ? 'Try another topic, network, or search.' : 'Follow a voice to see their sample stories here.'}</p>{view !== 'discover' && <Button asChild variant="outline" className="mt-5"><Link to="/">Explore creators<ArrowUpRight /></Link></Button>}</div>}
          </section>
          <aside aria-label="Creator discovery" className="border-t border-border pt-6 xl:border-t-0 xl:pt-0"><div className="mb-5 flex items-center justify-between"><h2 className="font-serif text-2xl italic">Voices to know</h2><Sparkles className="size-4 text-accent" /></div><VoicesToKnow /><div className="mt-7"><h3 className="mb-3 text-[10px] font-semibold uppercase text-muted-foreground">Around the open web</h3><div className="flex flex-wrap gap-2">{topics.slice(1).map(t => <Button key={t} variant="outline" size="sm" className="rounded-full text-xs" onClick={() => setTopic(t)}>{t}<ArrowUpRight className="size-3" /></Button>)}</div></div></aside>
        </div>
        </>}
      </main>
    </div>
    {!settingsView && <Composer assistantEnabled={state.assistantEnabled} onNavigate={url => { if (/^https?:\/\//i.test(url)) window.open(url, '_blank', 'noopener,noreferrer'); else { setQuery(url); setSubmitted(url); } }} />}
    {creatorDialog && <div className="social-backdrop fixed inset-0 z-[60] grid place-items-center px-5" onClick={() => setCreatorDialog(null)}><section role="dialog" aria-modal="true" aria-labelledby="creator-name" className="liquid-glass specular w-full max-w-sm rounded-3xl border border-border bg-card p-6" onClick={e => e.stopPropagation()}><div className="flex justify-between"><img className="social-avatar size-14" src={avatarPreset(creatorDialog.avatar_key).src} alt="" /><Button variant="ghost" size="icon" aria-label="Close creator profile" onClick={() => setCreatorDialog(null)}><X /></Button></div><h2 id="creator-name" className="mt-5 font-serif text-3xl">{creatorDialog.name}</h2><p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">{fullHandle(creatorDialog)} · <NetworkBadge network={creatorDialog.network} /></p><p className="mt-1 text-[11px] text-muted-foreground">Joined {creatorDialog.joined}{creatorDialog.follows_you ? ' · Follows you' : ''}</p><p className="mt-2 text-xs text-muted-foreground">{creatorDialog.followers} followers</p><p className="mt-5 text-sm leading-relaxed">{linkifyHashtagsWith(creatorDialog.bio, tag => { setTagFilter({ creatorId: creatorDialog.id, tag }); setCreatorDialog(null); })}</p><div className="mt-3 flex flex-wrap gap-2">{creatorDialog.featured_hashtags.map(t => <Button key={t.name} variant="ghost" className="atlas-profile-tag h-auto" onClick={() => { setTagFilter({ creatorId: creatorDialog.id, tag: t.name }); setCreatorDialog(null); }}>#{t.name} <small>{t.count} posts</small></Button>)}</div>{creatorDialog.podcast && <div className="mt-4"><p className="mb-2 flex items-center gap-1.5 text-xs text-muted-foreground"><NetworkBadge network="Podcasts" /> feed</p><div className="flex flex-wrap gap-2">{creatorDialog.podcast.features.map(feature => <span key={feature} className="atlas-feature-chip" style={{ color: networkBrands.Podcasts.color, background: `color-mix(in oklab, ${networkBrands.Podcasts.color} 10%, transparent)` }}>{podcastFeatureLabels[feature]}</span>)}</div><p className="mt-2 text-[11px] text-muted-foreground">{creatorDialog.podcast.feed_url}</p></div>}<dl className="atlas-profile-fields mt-4">{creatorDialog.fields.map(f => <div key={f.name} className="atlas-profile-field"><dt className="atlas-profile-field-name">{f.name}</dt><dd className={f.verified ? 'atlas-profile-field-value atlas-profile-verified' : 'atlas-profile-field-value'}>{f.url ? <a href={f.url} target="_blank" rel="me noopener noreferrer">{f.value}</a> : f.value}</dd></div>)}</dl><p className="mt-3 text-xs text-muted-foreground">Sample profile · no live account connected</p><Button className="mt-6 w-full" onClick={() => state.toggleFollow(creatorDialog.id)}>{state.followed.includes(creatorDialog.id) ? <Check /> : <Plus />}{state.followed.includes(creatorDialog.id) ? 'Following · unfollow' : 'Follow voice'}</Button></section></div>}
  </div></div>;
}

