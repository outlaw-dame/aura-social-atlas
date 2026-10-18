import { useEffect, useMemo, useState } from 'react';
import Framework7 from 'framework7/lite-bundle';
import Framework7React, {
  App, View, Page, Navbar, Link, Toolbar, Tabs, Tab, PageContent,
  Searchbar, List, ListItem, Block, BlockTitle, Card, CardContent, CardFooter, Button, Chip, Toggle, Segmented,
} from 'framework7-react';
import 'framework7/css/bundle';
import { Compass, Users, Bookmark, Settings as Gear } from 'lucide-react';
import { creators, posts, networks, matchesCreator } from '@/lib/social-catalogue';
import { useSocial } from '@/components/social/SocialState';
import { useAtlasAuth } from '@/components/social/AuthState';
import { avatarPreset } from '@/lib/atlas-avatars';

Framework7.use(Framework7React);

type Theme = 'ios' | 'md';

/** Picks the Framework7 theme from the visitor's device; ?theme=ios|md overrides for testing. */
function detectTheme(): Theme {
  const forced = new URLSearchParams(window.location.search).get('theme');
  if (forced === 'ios' || forced === 'md') return forced;
  return /android/i.test(navigator.userAgent) ? 'md' : 'ios';
}

function isDesktop() {
  const ua = navigator.userAgent;
  const mobile = /android|iphone|ipad|ipod/i.test(ua) || (/macintosh/i.test(ua) && navigator.maxTouchPoints > 1);
  return !mobile && window.innerWidth >= 1024;
}

export default function AtlasMobileApp() {
  const theme = useMemo(detectTheme, []);
  const { followed, saved, toggleFollow, toggleSave, dark, toggleDark, assistantEnabled, setAssistantEnabled } = useSocial();
  const auth = useAtlasAuth() as { user?: { email?: string } | null; profile?: { display_name: string | null; avatar_key: string | null } | null; signOut?: () => Promise<void> };
  const [query, setQuery] = useState('');
  const [title, setTitle] = useState('Discover');
  const [network, setNetwork] = useState<string>('All networks');

  useEffect(() => { if (isDesktop()) window.location.replace('/'); }, []);
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
  }, [dark]);

  const results = creators.filter(c => matchesCreator(c, query, network, 'All topics'));
  const creatorOf = (id: string) => creators.find(c => c.id === id)!;
  const followingPosts = posts.filter(p => followed.includes(p.creatorId));
  const savedPosts = posts.filter(p => saved.includes(p.id));

  const postCard = (p: (typeof posts)[number]) => {
    const c = creatorOf(p.creatorId);
    return (
      <Card key={p.id} outline={theme === 'ios'} raised={theme === 'md'} className="atlas-f7-card">
        <img src={p.image} alt={p.alt} loading="lazy" style={{ width: '100%', aspectRatio: '16/10', objectFit: 'cover', display: 'block' }} />
        <CardContent>
          <div style={{ fontSize: 12, opacity: 0.6 }}>{c.name} · {c.network} · {p.kind}</div>
          <div style={{ fontFamily: 'Instrument Serif, serif', fontSize: 24, lineHeight: 1.15, margin: '6px 0' }}>{p.title}</div>
          <div style={{ opacity: 0.75 }}>{p.excerpt}</div>
        </CardContent>
        <CardFooter>
          <Link external target="_blank" href={p.url}>Open</Link>
          <Link onClick={() => toggleSave(p.id)}>{saved.includes(p.id) ? 'Saved' : 'Save'}</Link>
        </CardFooter>
      </Card>
    );
  };

  const name = auth.profile?.display_name || auth.user?.email;

  return (
    <App theme={theme} darkMode={dark} name="Atlas" colors={{ primary: '#2f6fd6' }}>
      <View main>
        <Page pageContent={false}>
          <Navbar title={title} />
          <Toolbar tabbar icons bottom>
            <Link tabLink="#tab-discover" tabLinkActive><Compass className="icon" size={24} aria-hidden /><span className="tabbar-label">Discover</span></Link>
            <Link tabLink="#tab-following"><Users className="icon" size={24} aria-hidden /><span className="tabbar-label">Following</span></Link>
            <Link tabLink="#tab-saved"><Bookmark className="icon" size={24} aria-hidden /><span className="tabbar-label">Saved</span></Link>
            <Link tabLink="#tab-settings"><Gear className="icon" size={24} aria-hidden /><span className="tabbar-label">Settings</span></Link>
          </Toolbar>
          <Tabs>
            <Tab id="tab-discover" className="page-content" onTabShow={() => setTitle('Discover')} tabActive>
              <Searchbar placeholder="Search creators" disableButton={false} onInput={(e: any) => setQuery(e.target.value)} onClickClear={() => setQuery('')} />
              <Block>
                <Segmented strong round>
                  {networks.map(n => <Button key={n} small active={network === n} onClick={() => setNetwork(n)}>{n.replace(' networks', '')}</Button>)}
                </Segmented>
              </Block>
              <BlockTitle>Creators</BlockTitle>
              <List strong inset dividers mediaList>
                {results.map(c => (
                  <ListItem key={c.id} title={c.name} subtitle={`${c.handle} · ${c.network}`} text={c.bio}>
                    <div slot="media" style={{ width: 44, height: 44, borderRadius: 22, display: 'grid', placeItems: 'center', background: 'rgba(47,111,214,.12)', fontWeight: 600 }}>{c.initials}</div>
                    <Button slot="after" small round fill={!followed.includes(c.id)} tonal={followed.includes(c.id)} onClick={() => toggleFollow(c.id)}>
                      {followed.includes(c.id) ? 'Following' : 'Follow'}
                    </Button>
                  </ListItem>
                ))}
                {results.length === 0 && <ListItem title="No creators match your search" />}
              </List>
              <BlockTitle>Stories</BlockTitle>
              {posts.map(postCard)}
            </Tab>

            <Tab id="tab-following" className="page-content" onTabShow={() => setTitle('Following')}>
              {followingPosts.length ? followingPosts.map(postCard) : (
                <Block strong inset>Follow creators in Discover and their stories will show up here.</Block>
              )}
            </Tab>

            <Tab id="tab-saved" className="page-content" onTabShow={() => setTitle('Saved')}>
              {savedPosts.length ? savedPosts.map(postCard) : <Block strong inset>Stories you save appear here.</Block>}
            </Tab>

            <Tab id="tab-settings" className="page-content" onTabShow={() => setTitle('Settings')}>
              <BlockTitle>Account</BlockTitle>
              <List strong inset dividers>
                {auth.user ? (
                  <>
                    <ListItem title={name ?? 'Signed in'} footer={auth.user.email}>
                      <img slot="media" src={avatarPreset(auth.profile?.avatar_key).src} alt="" width={40} height={40} style={{ borderRadius: 20 }} />
                    </ListItem>
                    <ListItem link="#" title="Sign out" onClick={() => auth.signOut?.()} />
                  </>
                ) : (
                  <ListItem link="/auth" external title="Sign in or create account" />
                )}
              </List>
              <BlockTitle>Appearance</BlockTitle>
              <List strong inset dividers>
                <ListItem title="Dark mode"><Toggle slot="after" checked={dark} onToggleChange={toggleDark} /></ListItem>
              </List>
              <BlockTitle>Intelligence</BlockTitle>
              <List strong inset dividers>
                <ListItem title="AI assistant" footer="Off by default. Stored on this device.">
                  <Toggle slot="after" checked={assistantEnabled} onToggleChange={() => setAssistantEnabled(!assistantEnabled)} />
                </ListItem>
              </List>
              <Block>
                <Chip text={theme === 'ios' ? 'iOS design' : 'Material 3 design'} />
                <p style={{ opacity: 0.6, fontSize: 13 }}>Tip: use Share → Add to Home Screen to install Atlas.</p>
                <Link external href="/">Open the classic Atlas site</Link>
              </Block>
            </Tab>
          </Tabs>
        </Page>
      </View>
    </App>
  );
}
