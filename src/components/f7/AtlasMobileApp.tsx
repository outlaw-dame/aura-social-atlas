import { useEffect, useMemo, useState } from 'react';
import Framework7 from 'framework7/lite-bundle';
import Framework7React, {
  App, View, Page, Navbar, Link, Toolbar, Tabs, Tab, PageContent,
  Searchbar, List, ListItem, Block, BlockTitle, Card, CardContent, CardFooter, Button, Chip, Toggle, Segmented,
} from 'framework7-react';
import 'framework7/css/bundle';
import 'framework7-icons/css/framework7-icons.css';
import 'material-icons/iconfont/material-icons.css';
import { ComposeSheet, AssistantPopup, Icon } from './F7Extras';
import { Fab, NavRight, NavLeft, Panel, Popup, f7 } from 'framework7-react';
import { creators, posts, networks, matchesCreator, fullHandle, postsByTag, type Creator } from '@/lib/social-catalogue';
import { NetworkBadge } from '@/lib/networks';
import { linkifyHashtagsWith } from '@/lib/hashtags';
import { useSocial } from '@/components/social/SocialState';
import { useAtlasAuth } from '@/components/social/AuthState';
import { avatarPreset } from '@/lib/atlas-avatars';
import { ProfilePopup, EditProfileSheet } from './ProfilePopup';
import { CreatorPopup } from './CreatorPopup';
import { MobileRecentArticles, MobileFedizenFeed, useActivitySummary } from './FedizenMobile';
import { CreatorTag } from '@/components/social/CreatorTag';

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
  const [composeOpen, setComposeOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [editProfileOpen, setEditProfileOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [creatorOpen, setCreatorOpen] = useState<Creator | null>(null);
  const [tagFeed, setTagFeed] = useState<{ creatorId: string; tag: string } | null>(null);
  const [fabHidden, setFabHidden] = useState(false);
  const [mode, setMode] = useState<'light' | 'dark' | 'system'>('light');
  const [title, setTitle] = useState('Discover');
  const [network, setNetwork] = useState<string>('All networks');

  useEffect(() => { if (isDesktop()) window.location.replace('/'); }, []);
  useEffect(() => { setMode(dark ? 'dark' : 'light'); }, []);
  const [systemDark, setSystemDark] = useState(false);
  useEffect(() => {
    const q = window.matchMedia('(prefers-color-scheme: dark)');
    setSystemDark(q.matches);
    const on = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    q.addEventListener('change', on);
    return () => q.removeEventListener('change', on);
  }, []);
  const isDark = mode === 'system' ? systemDark : mode === 'dark';
  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDark);
    if (isDark !== dark) toggleDark();
  }, [isDark]);
  // Hide the floating buttons while the feed scrolls, bring them back when it settles.
  useEffect(() => {
    let t: number | undefined;
    const on = () => { setFabHidden(true); clearTimeout(t); t = window.setTimeout(() => setFabHidden(false), 700); };
    document.addEventListener('scroll', on, true);
    return () => { document.removeEventListener('scroll', on, true); clearTimeout(t); };
  }, []);

  const results = creators.filter(c => matchesCreator(c, query, network, 'All topics'));
  const creatorOf = (id: string) => creators.find(c => c.id === id);
  const tagFeedCreator = tagFeed ? creatorOf(tagFeed.creatorId) : null;
  const tagFeedPosts = tagFeed ? postsByTag(tagFeed.creatorId, tagFeed.tag) : [];
  const followingPosts = posts.filter(p => followed.includes(p.creatorId));
  const activityText = useActivitySummary();
  const savedPosts = posts.filter(p => saved.includes(p.id));

  const postCard = (p: (typeof posts)[number]) => {
    const c = creatorOf(p.creatorId);
    if (!c) return null;
    return (
      <Card key={p.id} outline={theme === 'ios'} raised={theme === 'md'} className="atlas-f7-card">
        <img src={p.image} alt={p.alt} loading="lazy" style={{ width: '100%', aspectRatio: '16/10', objectFit: 'cover', display: 'block' }} />
        <CardContent>
          <div style={{ fontFamily: 'Instrument Serif, serif', fontSize: 24, lineHeight: 1.15, margin: '6px 0' }}>{p.title}</div>
          <div style={{ opacity: 0.75 }}>{p.excerpt}</div>
          <div className="atlas-story-tags">{p.tags.map(tag => <Link key={tag} className="atlas-hashtag" onClick={() => setTagFeed({ creatorId: c.id, tag })}>#{tag}</Link>)}</div>
          <CreatorTag creator={c} onOpen={() => setCreatorOpen(c)} />
        </CardContent>
        <CardFooter>
          <Link external target="_blank" href={p.url}>Open</Link>
          <Link onClick={() => toggleSave(p.id)}>{saved.includes(p.id) ? 'Saved' : 'Save'}</Link>
        </CardFooter>
      </Card>
    );
  };

  return (
    <App theme={theme} darkMode={isDark} name="Atlas" colors={{ primary: '#FA243C' }}>
      <Panel left cover swipe resizable={false}>
        <Page>
          <Block style={{ fontFamily: 'Instrument Serif, serif', fontStyle: 'italic', fontSize: 32, marginTop: 24 }}>Atlas</Block>
          <List strong inset dividers>
            <ListItem link="#" panelClose title="Discover" selected={title === 'Discover'} onClick={() => f7.tab.show('#tab-discover')}>
              <Icon slot="media" ios="f7:compass" md="material:explore" />
            </ListItem>
            <ListItem link="#" panelClose title="Following" selected={title === 'Following'} onClick={() => f7.tab.show('#tab-following')} after={String(followed.length)}>
              <Icon slot="media" ios="f7:person_2" md="material:group" />
            </ListItem>
            <ListItem link="#" panelClose title="Saved" selected={title === 'Saved'} onClick={() => f7.tab.show('#tab-saved')} after={String(saved.length)}>
              <Icon slot="media" ios="f7:bookmark" md="material:bookmark" />
            </ListItem>
            <ListItem link="#" panelClose title="Settings" selected={title === 'Settings'} onClick={() => f7.tab.show('#tab-settings')}>
              <Icon slot="media" ios="f7:gear_alt" md="material:settings" />
            </ListItem>
          </List>
          <Block style={{ fontSize: 12, opacity: 0.6 }}>Sample profiles, not live accounts.</Block>
        </Page>
      </Panel>
      <View main>
        <Page pageContent={false}>
          <Navbar title={title}>
            <NavLeft>
              <Link iconOnly panelOpen="left" aria-label="Open menu"><Icon ios="f7:sidebar_left" md="material:menu" /></Link>
            </NavLeft>
            <NavRight>
              <Link iconOnly aria-label="Activity" onClick={() => f7.toast.show({ text: activityText, closeTimeout: 3000 })}>
                <Icon ios="f7:bell" md="material:notifications_none" />
              </Link>
              {auth.user ? (
                <Link iconOnly aria-label="Your profile" onClick={() => setProfileOpen(true)}>
                  <img src={avatarPreset(auth.profile?.avatar_key).src} alt="" width={30} height={30} style={{ borderRadius: 15 }} />
                </Link>
              ) : (
                <Link iconOnly external href="/auth" aria-label="Sign in">
                  <Icon ios="f7:person_crop_circle" md="material:account_circle" />
                </Link>
              )}
            </NavRight>
          </Navbar>
          <Fab position="right-bottom" slot="fixed" aria-label="Compose" onClick={() => setComposeOpen(true)}
            style={{ marginBottom: 'calc(var(--f7-toolbar-height) + var(--f7-safe-area-bottom))', transition: 'transform .25s, opacity .25s', transform: fabHidden ? 'translateY(120px)' : 'none', opacity: fabHidden ? 0 : 1 }}>
            <Icon ios="f7:square_pencil" md="material:edit" />
          </Fab>
          {assistantEnabled && (
            <Fab position="left-bottom" slot="fixed" color="white" aria-label="Open assistant" onClick={() => setChatOpen(true)}
              style={{ marginBottom: 'calc(var(--f7-toolbar-height) + var(--f7-safe-area-bottom))', transition: 'transform .25s, opacity .25s', transform: fabHidden ? 'translateY(120px)' : 'none', opacity: fabHidden ? 0 : 1 }}>
              <Icon ios="f7:sparkles" md="material:auto_awesome" />
            </Fab>
          )}
          <Toolbar tabbar icons bottom>
            <Link tabLink="#tab-discover" tabLinkActive><Icon ios="f7:compass" md="material:explore" /><span className="tabbar-label">Discover</span></Link>
            <Link tabLink="#tab-following"><Icon ios="f7:person_2" md="material:group" /><span className="tabbar-label">Following</span></Link>
            <Link tabLink="#tab-saved"><Icon ios="f7:bookmark" md="material:bookmark" /><span className="tabbar-label">Saved</span></Link>
            <Link tabLink="#tab-settings"><Icon ios="f7:gear_alt" md="material:settings" /><span className="tabbar-label">Settings</span></Link>
          </Toolbar>
          <Tabs>
            <Tab id="tab-discover" className="page-content" onTabShow={() => setTitle('Discover')} tabActive>
              <Searchbar placeholder="Search creators" disableButton={false} onInput={(e: any) => setQuery(e.target.value)} onClickClear={() => setQuery('')} />
              <Block>
                <Segmented strong round>
                  {networks.map(n => <Button key={n} small active={network === n} onClick={() => setNetwork(n)}>{n.replace(' networks', '')}</Button>)}
                </Segmented>
              </Block>
              <BlockTitle><span className="atlas-blocktitle-icon"><Icon ios="f7:person_2_square_stack" md="material:groups" /> Creators</span></BlockTitle>
              <List strong inset dividers mediaList className="atlas-creator-list">
                {results.map(c => (
                  <ListItem key={c.id} title={c.name}
                    onClick={() => setCreatorOpen(c)} style={{ cursor: 'pointer' }}>
                    <span slot="text">{linkifyHashtagsWith(c.bio, tag => setTagFeed({ creatorId: c.id, tag }))}</span>
                    <span slot="subtitle" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                      {c.handle} · <NetworkBadge network={c.network} />
                    </span>
                    <img slot="media" src={avatarPreset(c.avatar_key).src} alt="" width={44} height={44} style={{ borderRadius: 22 }} />
                    <Button slot="after" small round fill={!followed.includes(c.id)} tonal={followed.includes(c.id)}
                      onClick={(e: any) => { e.stopPropagation(); toggleFollow(c.id); }}>
                      {followed.includes(c.id) ? 'Following' : 'Follow'}
                    </Button>
                  </ListItem>
                ))}
                {results.length === 0 && <ListItem title="No creators match your search" />}
              </List>
              <MobileRecentArticles />
              <BlockTitle>Stories</BlockTitle>
              {posts.map(postCard)}
            </Tab>

            <Tab id="tab-following" className="page-content" onTabShow={() => setTitle('Following')}>
              <MobileFedizenFeed />
              <BlockTitle>Atlas creators you follow</BlockTitle>
              {followingPosts.length ? followingPosts.map(postCard) : (
                <Block strong inset>Follow creators in Discover and their stories will show up here.</Block>
              )}
            </Tab>

            <Tab id="tab-saved" className="page-content" onTabShow={() => setTitle('Saved')}>
              {savedPosts.length ? savedPosts.map(postCard) : <Block strong inset>Stories you save appear here.</Block>}
            </Tab>

            <Tab id="tab-settings" className="page-content" onTabShow={() => setTitle('Settings')}>
              <BlockTitle>Appearance</BlockTitle>
              <List strong inset dividers>
                <ListItem title="Light" radio radioIcon="end" name="mode" checked={mode === 'light'} onChange={() => setMode('light')} />
                <ListItem title="Dark" radio radioIcon="end" name="mode" checked={mode === 'dark'} onChange={() => setMode('dark')} />
                <ListItem title="Match device" radio radioIcon="end" name="mode" checked={mode === 'system'} onChange={() => setMode('system')} />
              </List>
              <BlockTitle>Intelligence</BlockTitle>
              <List strong inset dividers>
                <ListItem title="AI assistant" footer="Off by default. When on, a sparkle button opens chat.">
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
      <ProfilePopup opened={profileOpen} onClose={() => setProfileOpen(false)} onEditProfile={() => setEditProfileOpen(true)} onOpenCreator={setCreatorOpen} />
      <CreatorPopup creator={creatorOpen} onClose={() => setCreatorOpen(null)} onOpenTag={(c, tag) => { setCreatorOpen(null); setTagFeed({ creatorId: c.id, tag }); }} />
      <Popup opened={!!tagFeed} onPopupClosed={() => setTagFeed(null)}>
        {tagFeed && tagFeedCreator && (
          <Page>
            <Navbar title={`#${tagFeed.tag}`} subtitle={tagFeedCreator.name}>
              <NavRight>
                <Link iconOnly popupClose aria-label="Close tag feed">
                  <Icon ios="f7:xmark" md="material:close" />
                </Link>
              </NavRight>
            </Navbar>
            <Block strong inset style={{ fontSize: 13 }}>
              Stories by {tagFeedCreator.name} tagged <span className="atlas-hashtag">#{tagFeed.tag}</span>
            </Block>
            {tagFeedPosts.length ? tagFeedPosts.map(postCard) : (
              <Block strong inset>No stories with this tag yet.</Block>
            )}
          </Page>
        )}
      </Popup>
      <EditProfileSheet opened={editProfileOpen} onClose={() => setEditProfileOpen(false)} />
      <ComposeSheet opened={composeOpen} onClose={() => setComposeOpen(false)} />
      {assistantEnabled && <AssistantPopup opened={chatOpen} onClose={() => setChatOpen(false)} />}
    </App>
  );
}
