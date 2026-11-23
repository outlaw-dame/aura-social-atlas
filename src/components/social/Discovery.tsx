import { PostSearchResults } from './PostSearchResults';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { ArrowUpRight, Bell, CircleUserRound, Compass, Layers, Menu, MessagesSquare, Rss, Search, Settings, Sparkles, Users, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useSocial } from './SocialState';
import { Composer } from './Composer';
import { MessagesPage } from './MessagesPage';
import { useCollectionOpener } from './CollectionsDesktop';
import { Preferences } from './Preferences';
import { AccountButton } from './AccountButton';
import { Spotlight } from './Spotlight';
import { RecentArticles } from './RecentArticles';
import { FeedsView } from './FeedsView';
import { GatewayDiscovery } from './GatewayDiscovery';
import { VoicesToKnow } from './VoicesToKnow';
import { ProfilePage } from './ProfilePage';
import type { ProfileSection } from './profile-sections';
import { ActivityPage } from './ActivityPage';
import { GroupsPage } from './GroupsPage';
import { useAtlasAuth } from './AuthState';
import { useFedizenIdentity } from './useFedizenIdentity';
import { IdentityAvatar } from './IdentityAvatar';
import { DesktopHosts } from './DesktopHosts';
import { intelligenceReady, useIntelligence } from './useIntelligence';

export type DiscoveryView = 'feeds' | 'discover' | 'groups' | 'activity' | 'messages' | 'profile' | 'settings' | 'intelligence' | 'appearance' | 'moderation' | 'hashtags' | 'notifications';

/** The desktop page. Its navigation matches the phone app's dock: Feeds, Discover, Groups, Activity, your
 *  profile (Saved is a tab there; follows open from its Following count), then Settings. */
export function Discovery({ view = 'discover', profileSection, groupId }: { view?: DiscoveryView; profileSection?: ProfileSection; groupId?: string }) {
  const state = useSocial();
  // The assistant answers through /api/chat, so it needs a key kept on Atlas's server.
  const ai = useIntelligence().data;
  const aiReady = intelligenceReady(ai) && ai?.active?.where === 'server';
  const auth = useAtlasAuth();
  const identity = useFedizenIdentity();
  const [query, setQuery] = useState('');
  const [submitted, setSubmitted] = useState('');
  const [mobileOpen, setMobileOpen] = useState(false);
  const collections = useCollectionOpener();
  const title = view === 'feeds' ? 'Your corner of the web.' : 'A world of independent voices.';
  const nav = [
    { to: '/feeds' as const, label: 'Feeds', icon: Layers, key: 'feeds' },
    { to: '/' as const, label: 'Discover', icon: Compass, key: 'discover' },
    { to: '/groups' as const, label: 'Groups', icon: Users, key: 'groups' },
    { to: '/activity' as const, label: 'Activity', icon: Bell, key: 'activity' },
    { to: '/profile' as const, label: 'Profile', icon: CircleUserRound, key: 'profile' },
    { to: '/settings' as const, label: 'Settings', icon: Settings, key: 'settings' },
  ];

  const pageView = view === 'groups' || view === 'activity' || view === 'messages' || view === 'profile';
  const pageTitles = { groups: ['Communities on Fedizen and beyond', 'Groups'], activity: ['What’s new for you', 'Activity'], messages: ['Direct conversations', 'Messages'], profile: ['', ''] } as const;
  const settingsView = view === 'settings' || view === 'intelligence' || view === 'appearance' || view === 'moderation' || view === 'hashtags' || view === 'notifications';
  return <div><div className="social-app min-h-screen bg-background text-foreground">
    {mobileOpen && <Button variant="ghost" aria-label="Close navigation" onClick={() => setMobileOpen(false)} className="social-backdrop fixed inset-0 z-30 h-auto rounded-none lg:hidden" />}
    <aside className={`social-sidebar liquid-glass specular fixed inset-y-3 left-3 z-40 flex w-60 flex-col rounded-3xl border border-border p-5 transition-transform lg:translate-x-0 ${mobileOpen ? 'translate-x-0' : '-translate-x-[110%]'}`}>
      <div className="mb-9 flex items-center justify-between"><Link to="/" className="flex items-center gap-2 font-serif text-3xl italic"><Compass className="size-6 text-accent" strokeWidth={1.5} />Atlas</Link><Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setMobileOpen(false)} aria-label="Close menu"><X /></Button></div>
      <p className="mb-3 text-[10px] font-semibold uppercase text-muted-foreground">Your open web</p>
      <nav aria-label="Main navigation" className="space-y-1">{nav.map(item => <Button asChild variant="ghost" key={item.key} className={`h-11 w-full justify-start rounded-xl ${(view === item.key || (item.key === 'settings' && settingsView)) ? 'social-selected' : 'text-muted-foreground'}`}><Link to={item.to} onClick={() => setMobileOpen(false)} aria-current={(view === item.key || (item.key === 'settings' && settingsView)) ? 'page' : undefined}>{item.key === 'profile' && auth.user ? <IdentityAvatar src={identity.avatar} name={identity.name} className="social-avatar size-5 object-cover" /> : <item.icon />}{item.label}</Link></Button>)}</nav>
      <div className="mt-auto border-t border-border pt-4"><span className="flex items-center gap-2 text-xs text-muted-foreground"><Rss className="size-3" />Open web. Human voices.</span></div>
    </aside>
    <div className="lg:pl-[16.5rem]">
      <header className="social-header sticky top-0 z-20 flex h-16 items-center gap-2 px-5 sm:gap-3 sm:px-9">
        <Button variant="ghost" size="icon" className="liquid-glass specular shrink-0 rounded-full lg:hidden" aria-label="Open navigation" onClick={() => setMobileOpen(true)}><Menu /></Button>
        <form role="search" onSubmit={e => { e.preventDefault(); setSubmitted(query.trim()); }} className="liquid-glass specular flex h-9 min-w-0 flex-1 items-center gap-2 rounded-full border border-border px-3">
          <Search className="size-3.5 shrink-0 text-muted-foreground" /><label htmlFor="social-search" className="sr-only">Search posts</label><input id="social-search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search posts…" className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground" />
          {(query || submitted) && <Button type="button" variant="ghost" size="icon" className="size-6" aria-label="Clear search" onClick={() => { setQuery(''); setSubmitted(''); }}><X /></Button>}
          <Button variant="ghost" type="submit" size="icon" className="size-6" aria-label="Search"><ArrowUpRight /></Button>
        </form>
        <Button asChild variant="ghost" size="icon" className={`liquid-glass specular shrink-0 rounded-full ${view === 'messages' ? 'text-accent' : ''}`} aria-label="Messages" title="Messages"><Link to="/messages" aria-current={view === 'messages' ? 'page' : undefined}><MessagesSquare /></Link></Button>
        <Button asChild variant="ghost" size="icon" className="liquid-glass specular shrink-0 rounded-full lg:hidden" aria-label="Activity and notifications" title="Activity"><Link to="/activity"><Bell /></Link></Button>
        <AccountButton />
      </header>
      <main className="mx-auto max-w-[1400px] px-5 pb-28 pt-7 sm:px-9">
        {settingsView ? <Preferences page={view === 'intelligence' ? 'intelligence' : view === 'appearance' ? 'appearance' : view === 'moderation' ? 'moderation' : view === 'hashtags' ? 'hashtags' : view === 'notifications' ? 'notifications' : 'settings'} /> : view === 'profile' ? <div className="mx-auto max-w-4xl"><ProfilePage initialSection={profileSection} onOpenCollection={collections.open} /></div> : pageView ? <div className={`mx-auto ${view === 'groups' ? 'max-w-4xl' : 'max-w-3xl'}`}>
          {!(view === 'groups' && groupId) && <div className="mb-8 animate-float-up"><p className="mb-3 flex items-center gap-2 text-[10px] font-semibold uppercase text-muted-foreground"><span className="social-status-dot" />{pageTitles[view][0]}</p><h1 className="font-serif text-4xl leading-tight sm:text-5xl">{pageTitles[view][1]}</h1></div>}
          {view === 'activity' ? <ActivityPage /> : view === 'messages' ? <MessagesPage /> : <GroupsPage groupId={groupId} />}
        </div> : <>
        <div className="mb-8 animate-float-up"><p className="mb-3 flex items-center gap-2 text-[10px] font-semibold uppercase text-muted-foreground"><span className="social-status-dot" />{view === 'discover' ? 'Discover the open social web' : 'A feed of your own'}</p><h1 className="font-serif text-4xl leading-tight sm:text-5xl">{title}</h1><p className="mt-3 text-sm text-muted-foreground">{view === 'discover' ? 'Find creators, fresh perspectives, and conversations beyond your usual circle.' : 'The latest from the voices you choose.'}</p></div>
        <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-10 xl:grid-cols-[minmax(0,1fr)_260px]">
          <section aria-label={submitted ? 'Search results' : view === 'feeds' ? 'Feeds' : 'Discover'}>
            {submitted ? <PostSearchResults q={submitted} /> : view === 'feeds' ? <FeedsView /> : <><GatewayDiscovery /><Spotlight /><RecentArticles /></>}
          </section>
          <aside aria-label="Creator discovery" className="border-t border-border pt-6 xl:border-t-0 xl:pt-0"><div className="mb-5 flex items-center justify-between"><h2 className="font-serif text-2xl italic">Voices to know</h2><Sparkles className="size-4 text-accent" /></div><VoicesToKnow /></aside>
        </div>
        </>}
      </main>
    </div>
    {!settingsView && <Composer assistantEnabled={state.assistantEnabled && aiReady} onNavigate={url => { if (/^https?:\/\//i.test(url)) window.open(url, '_blank', 'noopener,noreferrer'); else { setQuery(url); setSubmitted(url); } }} />}
    <DesktopHosts collections={collections} />
  </div></div>;
}

