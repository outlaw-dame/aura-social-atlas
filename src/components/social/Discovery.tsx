import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { ArrowUpRight, Bookmark, Check, Compass, Menu, Moon, Plus, Rss, Search, Sparkle, Sparkles, Sun, Users, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { creators, matchesCreator, networks, posts, topics, type Creator } from '@/lib/social-catalogue';
import { useSocial } from './SocialState';
import { AssistantOverlay } from './Assistant';

export function Discovery({ view = 'discover' }: { view?: 'discover' | 'following' | 'saved' | 'intelligence' }) {
  const state = useSocial();
  const [query, setQuery] = useState('');
  const [submitted, setSubmitted] = useState('');
  const [network, setNetwork] = useState('All networks');
  const [topic, setTopic] = useState('All topics');
  const [mobileOpen, setMobileOpen] = useState(false);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [creatorDialog, setCreatorDialog] = useState<Creator | null>(null);
  const matching = creators.filter(c => matchesCreator(c, submitted, network, topic));
  const feed = posts.filter(p => matching.some(c => c.id === p.creatorId) && (view !== 'following' || state.followed.includes(p.creatorId)) && (view !== 'saved' || state.saved.includes(p.id)));
  const searchActive = !!submitted || network !== 'All networks' || topic !== 'All topics';
  const title = view === 'following' ? 'Your corner of the web.' : view === 'saved' ? 'Worth coming back to.' : 'A world of independent voices.';
  const nav = [{ to: '/' as const, label: 'Discover', icon: Compass, key: 'discover' }, { to: '/following' as const, label: 'Following', icon: Users, key: 'following' }, { to: '/saved' as const, label: 'Saved', icon: Bookmark, key: 'saved' }, { to: '/intelligence' as const, label: 'Intelligence', icon: Sparkle, key: 'intelligence' }];
  const toggleTopic = (value: string) => { setTopic(value); setMobileOpen(false); };
  return <div className={state.dark ? 'dark' : ''}><div className="social-app min-h-screen bg-background text-foreground">
    {mobileOpen && <Button variant="ghost" aria-label="Close navigation" onClick={() => setMobileOpen(false)} className="social-backdrop fixed inset-0 z-30 h-auto rounded-none lg:hidden" />}
    <aside className={`social-sidebar liquid-glass specular fixed inset-y-3 left-3 z-40 flex w-60 flex-col rounded-3xl border border-border p-5 transition-transform lg:translate-x-0 ${mobileOpen ? 'translate-x-0' : '-translate-x-[110%]'}`}>
      <div className="mb-9 flex items-center justify-between"><Link to="/" className="flex items-center gap-2 font-serif text-3xl italic"><Compass className="size-6 text-accent" strokeWidth={1.5} />Atlas</Link><Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setMobileOpen(false)} aria-label="Close menu"><X /></Button></div>
      <p className="mb-3 text-[10px] font-semibold uppercase text-muted-foreground">Your open web</p>
      <nav aria-label="Main navigation" className="space-y-1">{nav.map(item => <Button asChild variant="ghost" key={item.key} className={`h-11 w-full justify-start rounded-xl ${view === item.key ? 'social-selected' : 'text-muted-foreground'}`}><Link to={item.to} onClick={() => setMobileOpen(false)} aria-current={view === item.key ? 'page' : undefined}><item.icon />{item.label}{item.key === 'following' && <span className="ml-auto text-xs">{state.followed.length}</span>}{item.key === 'saved' && <span className="ml-auto text-xs">{state.saved.length}</span>}</Link></Button>)}</nav>
      <div className="mt-8 border-t border-border pt-5"><p className="mb-3 text-[10px] font-semibold uppercase text-muted-foreground">Explore topics</p>{topics.slice(1).map(t => <Button key={t} variant="ghost" onClick={() => toggleTopic(t)} className={`mb-1 h-9 w-full justify-start text-sm ${topic === t ? 'text-accent' : 'text-muted-foreground'}`}><span className="social-topic-dot" />{t}</Button>)}</div>
      <div className="mt-7"><p className="mb-3 text-[10px] font-semibold uppercase text-muted-foreground">Your voices</p>{state.followed.length === 0 ? <p className="text-xs leading-relaxed text-muted-foreground">No voices followed yet.</p> : creators.filter(c => state.followed.includes(c.id)).map(c => <Button variant="ghost" key={c.id} onClick={() => setCreatorDialog(c)} className="mb-2 h-auto w-full justify-start whitespace-normal px-0 text-left text-xs"><span className="social-avatar size-7 shrink-0 text-[9px]">{c.initials}</span><span>{c.name}</span></Button>)}</div>
      <div className="mt-auto border-t border-border pt-4"><span className="flex items-center gap-2 text-xs text-muted-foreground"><Rss className="size-3" />Open web. Human voices.</span><span className="mt-2 block text-[10px] text-muted-foreground">Sample edition · session-only selections</span></div>
    </aside>
    <div className="lg:pl-[16.5rem]">
      <header className="social-header sticky top-0 z-20 flex h-20 items-center gap-3 px-5 sm:px-9">
        <Button variant="ghost" size="icon" className="liquid-glass specular shrink-0 rounded-full lg:hidden" aria-label="Open navigation" onClick={() => setMobileOpen(true)}><Menu /></Button>
        <form role="search" onSubmit={e => { e.preventDefault(); setSubmitted(query.trim()); }} className="liquid-glass specular flex h-11 min-w-0 flex-1 items-center gap-3 rounded-full border border-border px-4">
          <Search className="size-4 shrink-0 text-muted-foreground" /><label htmlFor="social-search" className="sr-only">Search creators and topics</label><input id="social-search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search voices, ideas, and interests…" className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground" />
          {(query || submitted) && <Button type="button" variant="ghost" size="icon" className="size-7" aria-label="Clear search" onClick={() => { setQuery(''); setSubmitted(''); }}><X /></Button>}
          <Button variant="ghost" type="submit" size="icon" className="size-7" aria-label="Search"><ArrowUpRight /></Button>
        </form>
        <Button variant="ghost" size="icon" onClick={state.toggleDark} className="liquid-glass specular shrink-0 rounded-full border border-border" aria-label={state.dark ? 'Switch to light theme' : 'Switch to dark theme'}>{state.dark ? <Sun /> : <Moon />}</Button>
      </header>
      <main className="mx-auto max-w-[1400px] px-5 pb-28 pt-7 sm:px-9">
        {view === 'intelligence' ? <Intelligence /> : <>
        <div className="mb-8 animate-float-up"><p className="mb-3 flex items-center gap-2 text-[10px] font-semibold uppercase text-muted-foreground"><span className="social-status-dot" />{view === 'discover' ? 'Discover the open social web' : view === 'following' ? 'A feed of your own' : 'Your reading list'}</p><h1 className="font-serif text-4xl leading-tight sm:text-5xl">{title}</h1><p className="mt-3 text-sm text-muted-foreground">{view === 'discover' ? 'Find creators, fresh perspectives, and conversations beyond your usual circle.' : view === 'following' ? 'The latest from the voices you choose.' : 'Stories and ideas you’ve set aside.'}</p></div>
        <div className="mb-8 flex flex-wrap items-center justify-between gap-4 border-b border-border pb-5">
          <div className="flex flex-wrap gap-1" aria-label="Filter by network">{networks.map(n => <Button key={n} variant="ghost" size="sm" onClick={() => setNetwork(n)} aria-pressed={network === n} className={`rounded-full ${network === n ? 'social-selected' : 'text-muted-foreground'}`}>{n === 'RSS' && <Rss className="size-3" />}{n}</Button>)}</div>
          <label className="flex items-center gap-2 text-xs text-muted-foreground">Topic<select aria-label="Filter by topic" value={topic} onChange={e => setTopic(e.target.value)} className="rounded-lg border border-border bg-background px-2 py-2 text-foreground">{topics.map(t => <option key={t}>{t}</option>)}</select></label>
        </div>
        {searchActive && <div role="status" className="mb-6 flex flex-wrap items-center gap-3 text-sm"><span>{feed.length} stories{submitted ? ` for “${submitted}”` : ''}</span><Button size="sm" variant="link" onClick={() => { setQuery(''); setSubmitted(''); setNetwork('All networks'); setTopic('All topics'); }}>Reset filters</Button></div>}
        <div className="grid items-start gap-10 xl:grid-cols-[minmax(0,1fr)_260px]">
          <section aria-label="Stories">
            <div className="mb-5 flex items-baseline justify-between"><h2 className="font-serif text-2xl italic">{view === 'discover' ? searchActive ? 'From the community' : 'The discovery edit' : view === 'following' ? 'Following' : 'Saved stories'}</h2><span className="text-[10px] uppercase text-muted-foreground">Sample stories</span></div>
            {feed.length ? <div className="grid gap-x-6 gap-y-9 sm:grid-cols-2">{feed.map((p, i) => {
              const creator = creators.find(c => c.id === p.creatorId);
              if (!creator) return null;
              return <article key={p.id} className={view === 'discover' && !searchActive && i === 0 ? 'sm:col-span-2' : ''}>
                <a href={p.url} target="_blank" rel="noreferrer" className="group relative block overflow-hidden rounded-2xl"><img src={p.image} alt={p.alt} className={`w-full object-cover transition-transform duration-700 group-hover:scale-[1.025] ${i === 0 && view === 'discover' && !searchActive ? 'aspect-[16/9]' : 'aspect-[4/3]'}`} loading={i === 0 ? 'eager' : 'lazy'} /><span className="social-image-label absolute bottom-4 left-4 rounded-full px-3 py-1 text-[10px] font-medium">{creator.topic} · {p.kind}</span></a>
                <div className="mt-4 flex items-center gap-2"><Button variant="ghost" onClick={() => setCreatorDialog(creator)} className="h-auto justify-start p-0 text-xs"><span className="social-avatar size-7 text-[9px]">{creator.initials}</span>{creator.name}</Button><span className="ml-auto text-[10px] text-muted-foreground">{creator.network}</span><Button variant="ghost" size="icon" className="size-8 shrink-0" aria-label={state.saved.includes(p.id) ? `Unsave ${p.title}` : `Save ${p.title}`} aria-pressed={state.saved.includes(p.id)} title="Save story" onClick={() => state.toggleSave(p.id)}><Bookmark className={state.saved.includes(p.id) ? 'fill-accent text-accent' : 'text-muted-foreground'} /></Button></div>
                <h3 className={`mt-3 font-serif leading-tight ${i === 0 && view === 'discover' && !searchActive ? 'text-3xl' : 'text-2xl'}`}><a href={p.url} target="_blank" rel="noreferrer">{p.title}</a></h3><p className="mt-2 text-sm leading-relaxed text-muted-foreground">{p.excerpt}</p>
              </article>;
            })}</div> : <div className="py-16 text-center"><Compass className="mx-auto mb-4 size-8 text-muted-foreground" /><h3 className="font-serif text-2xl">{searchActive ? 'No matches this time.' : view === 'following' ? 'Find your people.' : 'A little space for later.'}</h3><p className="mx-auto mt-3 max-w-xs text-sm text-muted-foreground">{searchActive ? 'Try another topic, network, or search.' : view === 'following' ? 'Follow a voice to see their sample stories here.' : 'Your saved sample stories will appear here.'}</p>{view !== 'discover' && <Button asChild variant="outline" className="mt-5"><Link to="/">Explore creators<ArrowUpRight /></Link></Button>}</div>}
          </section>
          <aside aria-label="Creator discovery" className="border-t border-border pt-6 xl:border-t-0 xl:pt-0"><div className="mb-5 flex items-center justify-between"><h2 className="font-serif text-2xl italic">Voices to know</h2><Sparkles className="size-4 text-accent" /></div><p className="mb-5 text-[11px] text-muted-foreground">Sample profiles, not live accounts</p><div className="space-y-6">{matching.map(c => <div key={c.id} className="border-b border-border pb-5"><div className="mb-3 flex items-center gap-3"><Button variant="ghost" className="h-auto flex-1 justify-start whitespace-normal p-0 text-left" onClick={() => setCreatorDialog(c)}><span className="social-avatar size-10 shrink-0 text-xs">{c.initials}</span><span><span className="block text-xs font-semibold">{c.name}</span><span className="mt-1 block text-[10px] font-normal text-muted-foreground">{c.network} · {c.topic}</span></span></Button><Button variant="outline" size="icon" className={`size-8 shrink-0 rounded-full ${state.followed.includes(c.id) ? 'text-accent' : ''}`} onClick={() => state.toggleFollow(c.id)} aria-label={state.followed.includes(c.id) ? `Unfollow ${c.name}` : `Follow ${c.name}`} aria-pressed={state.followed.includes(c.id)} title={state.followed.includes(c.id) ? 'Unfollow' : 'Follow'}>{state.followed.includes(c.id) ? <Check /> : <Plus />}</Button></div><p className="text-xs leading-relaxed text-muted-foreground">{c.bio}</p></div>)}</div>{!matching.length && <p className="text-sm text-muted-foreground">No creators match these filters.</p>}<div className="mt-7"><h3 className="mb-3 text-[10px] font-semibold uppercase text-muted-foreground">Around the open web</h3><div className="flex flex-wrap gap-2">{topics.slice(1).map(t => <Button key={t} variant="outline" size="sm" className="rounded-full text-xs" onClick={() => setTopic(t)}>{t}<ArrowUpRight className="size-3" /></Button>)}</div></div></aside>
        </div>
        </>}
      </main>
    </div>
    {state.assistantEnabled && view !== 'intelligence' && <AssistantOverlay open={assistantOpen} onOpenChange={setAssistantOpen} onNavigate={url => { if (/^https?:\/\//i.test(url)) window.open(url, '_blank', 'noopener,noreferrer'); else { setQuery(url); setSubmitted(url); } }} />}
    {creatorDialog && <div className="social-backdrop fixed inset-0 z-[60] grid place-items-center px-5" onClick={() => setCreatorDialog(null)}><section role="dialog" aria-modal="true" aria-labelledby="creator-name" className="liquid-glass specular w-full max-w-sm rounded-3xl border border-border bg-card p-6" onClick={e => e.stopPropagation()}><div className="flex justify-between"><span className="social-avatar size-14 text-lg">{creatorDialog.initials}</span><Button variant="ghost" size="icon" aria-label="Close creator profile" onClick={() => setCreatorDialog(null)}><X /></Button></div><h2 id="creator-name" className="mt-5 font-serif text-3xl">{creatorDialog.name}</h2><p className="mt-2 text-xs text-muted-foreground">{creatorDialog.handle} · {creatorDialog.network}</p><p className="mt-5 text-sm leading-relaxed">{creatorDialog.bio}</p><p className="mt-3 text-xs text-muted-foreground">Sample profile · no live account connected</p><Button className="mt-6 w-full" onClick={() => state.toggleFollow(creatorDialog.id)}>{state.followed.includes(creatorDialog.id) ? <Check /> : <Plus />}{state.followed.includes(creatorDialog.id) ? 'Following · unfollow' : 'Follow voice'}</Button></section></div>}
  </div></div>;
}

function Intelligence() {
  const state = useSocial();
  const on = state.assistantEnabled;
  return <div className="max-w-2xl animate-float-up">
    <p className="mb-3 text-[10px] font-semibold uppercase text-muted-foreground">Settings</p>
    <h1 className="font-serif text-4xl leading-tight sm:text-5xl">Intelligence</h1>
    <p className="mt-3 text-sm text-muted-foreground">Atlas works fully without AI. Turn on the assistant only if you want it.</p>
    <div className="mt-8 flex items-start justify-between gap-6 rounded-3xl border border-border bg-card p-6">
      <div><h2 className="text-base font-semibold">Atlas assistant</h2><p className="mt-1 text-sm leading-relaxed text-muted-foreground">Adds a small assistant button to the corner of your screen. It can answer questions and run searches for you. Your messages are sent to an AI service to generate replies.</p></div>
      <button role="switch" aria-checked={on} aria-label="Atlas assistant" onClick={() => state.setAssistantEnabled(!on)} className={`relative h-7 w-12 shrink-0 rounded-full transition ${on ? 'bg-accent' : 'bg-muted'}`}><span className={`absolute top-1 size-5 rounded-full bg-background shadow transition-all ${on ? 'left-6' : 'left-1'}`} /></button>
    </div>
  </div>;
}
