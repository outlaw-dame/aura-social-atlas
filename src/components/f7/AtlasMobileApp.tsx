import { MobilePostSearch } from './MobilePostSearch';
import { NotificationSettingsPage } from './NotificationSettings';
import { useOpenActivityFromPush } from '@/components/social/usePush';
import { LiveUpdates } from '@/components/social/LiveUpdates';
import { SemanticIndexer } from '@/components/social/useSemanticIndex';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import Framework7 from 'framework7/lite-bundle';
import Framework7React, {
  App, View, Page, Navbar, Link, Toolbar, Tabs, Tab,
  Searchbar, List, ListItem, Block, BlockTitle, Chip,
} from 'framework7-react';
import { holdF7Styles } from './f7-styles';
import { ComposeSheet, AssistantPopup, Icon } from './F7Extras';
import { Fab, NavRight, NavLeft, Panel, f7, f7ready, Badge } from 'framework7-react';
import { OPEN_TAG_EVENT } from '@/lib/hashtags';
import { useSocial } from '@/components/social/SocialState';
import { useAtlasAuth } from '@/components/social/AuthState';
import { useFedizenIdentity } from '@/components/social/useFedizenIdentity';
import { ProfileView, EditProfileSheet } from './ProfileView';
import { CollectionPopup } from './Collections';
import { AccentPicker } from '@/components/social/AccentPicker';
import { AvatarShapePicker } from '@/components/social/AvatarShapePicker';
import { useAvatarShape } from '@/lib/avatar-shape';
import { currentAppearance } from '@/lib/theme-mode';
import { accentHex, useAccent } from '@/lib/accent';
import { FediProfilePopup } from './FediProfile';
import { MiniPlayer } from './MiniPlayer';
import { useFediProfileOpener } from '@/components/social/useFediProfile';
import { GroupPopup, MobileGroups } from './Groups';
import { OPEN_GROUP_EVENT, groupStub, type Group, type GroupTarget } from '@/lib/groups';
import { OPEN_COLLECTION_EVENT, type Collection } from '@/lib/collections';
import { MobileRecentArticles, MobileActivity, MessagesPopup, FollowRequestsPage } from './FedizenMobile';
import { badgeText, useUnreadActivity } from '@/components/social/useNotificationGroups';
import { MobileFeeds } from './MobileFeeds';
import { FollowedTagsPage, TagFeedPage } from './TagFeed';
import { bindStack, popToRoot, postPageUrl, pushPage, showTab, tagPageUrl } from './navigation';
import { BlockedPeoplePage, ModerationPage, MutedPeoplePage } from './Moderation';
import { MobileImportPage } from './ImportPage';
import { AppearancePage, MobileSettingsList } from './SettingsPages';
import { MobileSpotlight, MobileVoicesToKnow } from './Discover';
import { IntelligencePage, KeywordFilterPage, KeywordFiltersPage } from './Intelligence';
import { MobileModerationSuggestionsPage } from './ModerationSuggestions';
import { intelligenceReady, useIntelligence } from '@/components/social/useIntelligence';
import { GatewayDiscovery } from '@/components/social/GatewayDiscovery';
import { Spotlight } from '@/components/social/Spotlight';
import { VoicesToKnow } from '@/components/social/VoicesToKnow';
import { describeProfile, type DeviceProfile } from '@/lib/device-profile';
import { useDeviceProfile } from '@/lib/use-device-profile';
import { VideoDock } from '@/components/social/VideoDock';
import { registerAppServiceWorker } from '@/lib/register-sw';
import { useComposeIntent } from '@/lib/compose-intent';
import { ThreadPage } from './Thread';
import { OPEN_POST_EVENT, type OpenPostDetail } from '@/lib/open-post';

Framework7.use(Framework7React);

type Theme = 'ios' | 'md';

/** Framework7 theme: Material on Android, iOS elsewhere; ?theme=ios|md overrides for testing.
 *  Framework7 picks its theme at start-up, so this is read once. */
function pickTheme(profile: DeviceProfile): Theme {
  const forced = new URLSearchParams(window.location.search).get('theme');
  if (forced === 'ios' || forced === 'md') return forced;
  return profile.theme;
}

const NAV_WIDTH = { rail: 88, sidebar: 280 } as const;
const LAYOUT_KEYS = ['layout', 'nav', 'panes', 'span', 'form'] as const;
const LAYOUT_VARS = ['--atlas-main-w', '--atlas-rail-w', '--atlas-hinge', '--atlas-top-h', '--atlas-bottom-y', '--f7-panel-width'];

/** Applies the device profile to Framework7: navigation (tab bar, side tab bar, rail, sidebar, tabletop deck),
 *  panes (single column, or the desktop-style feed + voices column, split at the fold when folded). Layout comes from window size and the fold only. */
function useAdaptiveLayout(profile: DeviceProfile) {
  const hasTabbar = (p: DeviceProfile) => p.nav === 'tabbar' || p.nav === 'tabbar-side' || p.nav === 'deck';
  const tabbarNow = useRef(hasTabbar(profile));
  // Framework7 shows the tab bar again on every page that comes in unless the page carries "no-toolbar"
  // (components/toolbar, pageBeforeIn), so with a rail or sidebar a pushed page (a conversation, a tag) brought the
  // tab bar back beside it. React owns the pages' class names, so instead the bar is hidden again right after
  // Framework7's own handler, in the same event, before anything is painted.
  useEffect(() => {
    let off = () => {};
    f7ready(() => {
      const keep = () => { if (!tabbarNow.current) f7.toolbar.hide('.atlas-tabbar', false); };
      f7.on('pageBeforeIn', keep);
      off = () => f7.off('pageBeforeIn', keep);
    });
    return () => off();
  }, []);
  useEffect(() => {
    const html = document.documentElement;
    for (const k of LAYOUT_KEYS) html.dataset[k] = String(profile[k]);
    const navW = profile.nav === 'rail' || profile.nav === 'sidebar' ? NAV_WIDTH[profile.nav] : 0;
    const [a, b] = profile.segs ?? [];
    if (profile.panes === 'fold' && a && b) {
      // Folded: the feed fills the first screen, the voices column the second.
      const foldX = a.x + a.width;
      html.style.setProperty('--atlas-main-w', `${Math.max(240, foldX - navW)}px`);
      html.style.setProperty('--atlas-hinge', `${Math.max(0, b.x - foldX)}px`);
    } else if (profile.panes === 'flat') {
      // Flat: like the desktop page, a wide feed and a ~260–320px "Voices to know" column.
      html.style.setProperty('--atlas-rail-w', `${Math.round(Math.min(320, Math.max(260, (profile.width - navW) * 0.3)))}px`);
      html.style.setProperty('--atlas-hinge', '0px');
    }
    if (profile.layout === 'tabletop' && a && b) {
      html.style.setProperty('--atlas-top-h', `${a.y + a.height}px`);
      html.style.setProperty('--atlas-bottom-y', `${b.y}px`);
    }
    html.style.setProperty('--f7-panel-width', profile.nav === 'rail' ? '88px' : '280px');
    html.classList.toggle('atlas-rail', profile.nav === 'rail');
    f7ready(() => {
      const panel = f7.panel.get('.atlas-panel');
      if (panel) {
        panel.disableVisibleBreakpoint();
        if (panel.opened) panel.close(false);
        if (navW) {
          // The panel starts without a breakpoint on compact devices (no sidebar flash on load);
          // setting one here lets Framework7 hold it open as the rail or sidebar.
          panel.params.visibleBreakpoint = 1;
          panel.enableVisibleBreakpoint();
        }
      }
      const tabbar = hasTabbar(profile);
      tabbarNow.current = tabbar;
      if (tabbar) f7.toolbar.show('.atlas-tabbar', false); else f7.toolbar.hide('.atlas-tabbar', false);
      // Floating players (video, podcast) sit above the tab bar only when there is one (not with a rail or sidebar).
      html.classList.toggle('atlas-has-tabbar', tabbar);
    });
  }, [profile]);
  // The <html> element is shared with the classic site: clear everything when /app unmounts.
  useEffect(() => () => {
    const html = document.documentElement;
    for (const k of LAYOUT_KEYS) delete html.dataset[k];
    for (const v of LAYOUT_VARS) html.style.removeProperty(v);
    html.classList.remove('atlas-rail', 'atlas-has-tabbar');
  }, []);
}

export default function AtlasMobileApp() {
  // Framework7's styles only while the phone app is on screen (f7-styles.ts).
  useLayoutEffect(() => holdF7Styles(), []);
  const profile = useDeviceProfile();
  const theme = useMemo(() => pickTheme(profile), []); // eslint-disable-line react-hooks/exhaustive-deps
  // Hold the panel open from the first frame only when the first layout wants a rail or sidebar.
  const panelHeldAtStart = useMemo(() => profile.nav === 'rail' || profile.nav === 'sidebar', []); // eslint-disable-line react-hooks/exhaustive-deps
  useAdaptiveLayout(profile);
  useEffect(registerAppServiceWorker, []);
  // A tapped notification opens Activity (public/sw.js posts this to the open app).
  useOpenActivityFromPush(useCallback(() => { try { showTab('tab-activity'); } catch { /* not ready */ } }, []));
  const { appearance, assistantEnabled: assistantWanted } = useSocial();
  // The assistant answers with the person's own key: only there once Intelligence is on with a key.
  const intelligence = useIntelligence();
  const assistantEnabled = assistantWanted && intelligenceReady(intelligence.data) && intelligence.data?.active?.where === 'server';
  const auth = useAtlasAuth() as { user?: { email?: string } | null; profile?: { display_name: string | null; avatar_key: string | null } | null; signOut?: () => Promise<void> };
  const identity = useFedizenIdentity();
  const [query, setQuery] = useState('');
  const [composeOpen, setComposeOpen] = useState(false);
  // Boost → Quote on any post opens the composer (ComposeSheet attaches the post).
  const composeIntent = useComposeIntent();
  useEffect(() => { if (composeIntent) setComposeOpen(true); }, [composeIntent]);
  const [editProfileOpen, setEditProfileOpen] = useState(false);
  const [collectionOpen, setCollectionOpen] = useState<{ collection?: Collection; id?: string; link?: string } | null>(null);
  const [groupOpen, setGroupOpen] = useState<Group | null>(null);
  // Pushed pages (a hashtag's feed) live in the stack view laid over the tabs; see navigation.ts.
  useEffect(() => {
    let off = () => {};
    f7ready(() => { off = bindStack(); });
    return () => off();
  }, []);
  // A hashtag in a post (or a followed-tag line) pushes its feed onto the main view, like any feed.
  useEffect(() => {
    const on = (e: Event) => { const t = (e as CustomEvent<{ tag?: string }>).detail?.tag; if (t) pushPage(tagPageUrl(t)); };
    window.addEventListener(OPEN_TAG_EVENT, on);
    return () => window.removeEventListener(OPEN_TAG_EVENT, on);
  }, []);
  // A tapped post pushes its conversation onto the main view, as a hashtag's feed is.
  useEffect(() => {
    const on = (e: Event) => { const d = (e as CustomEvent<OpenPostDetail>).detail; if (d?.statusId) pushPage(postPageUrl(d.statusId), { seed: d.seed }); };
    window.addEventListener(OPEN_POST_EVENT, on);
    return () => window.removeEventListener(OPEN_POST_EVENT, on);
  }, []);
  // A "Popular in" chip in For You opens its group here.
  useEffect(() => {
    const on = (e: Event) => { const t = (e as CustomEvent<GroupTarget>).detail; if (t?.id) setGroupOpen(groupStub(t)); };
    window.addEventListener(OPEN_GROUP_EVENT, on);
    return () => window.removeEventListener(OPEN_GROUP_EVENT, on);
  }, []);
  // Collection links in posts open here, as on Mastodon (tagged_collections).
  useEffect(() => {
    const on = (e: Event) => { const link = (e as CustomEvent<{ link?: string }>).detail?.link; if (link) setCollectionOpen({ link }); };
    window.addEventListener(OPEN_COLLECTION_EVENT, on);
    return () => window.removeEventListener(OPEN_COLLECTION_EVENT, on);
  }, []);
  // Shared links open the collection in the app: /app?collection=<Atlas id> or ?collection=<Mastodon collection URL>.
  useEffect(() => {
    const v = new URLSearchParams(window.location.search).get('collection');
    if (!v) return;
    if (/^[0-9a-f-]{36}$/i.test(v)) setCollectionOpen({ id: v });
    else if (/^https:\/\/[^/]+\/collections\/[A-Za-z0-9_-]+\/?$/.test(v)) setCollectionOpen({ link: v });
  }, []);
  const [chatOpen, setChatOpen] = useState(false);
  const [fabHidden, setFabHidden] = useState(false);
  const [messagesOpen, setMessagesOpen] = useState(false);
  const accent = useAccent();
  useAvatarShape();
  // Framework7 derives its theme palette from the primary color; recompute it when the reader picks another accent.
  useEffect(() => { f7ready(() => f7.setColorTheme(accentHex(accent))); }, [accent]);
  const fediProfile = useFediProfileOpener();
  /* Search lives on Discover: go there and put the cursor in the field. */
  const openSearch = () => {
    showTab('tab-discover');
    window.setTimeout(() => { const el = document.querySelector<HTMLInputElement>('#tab-discover .searchbar input'); el?.scrollIntoView({ block: 'center', behavior: 'smooth' }); el?.focus(); }, 80);
  };
  const [title, setTitle] = useState('Discover');
  // Feeds stays mounted under the other dock tabs; it counts posts as seen only while its tab is on screen.
  const [feedsShown, setFeedsShown] = useState(false);
  const [activityShown, setActivityShown] = useState(false);
  // Unread notifications, on the Activity tab as Bluesky and Mastodon's apps badge it (Fedizen's notifications marker).
  const unread = badgeText(useUnreadActivity());

  // Dim and Dark are both Framework7's dark mode; Dim only swaps the palette (data-theme="dim", styles.css). Framework7
  // starts from the class THEME_BOOT_SCRIPT put on <html> (no darkMode prop) and follows later changes here; the live
  // value is read, not this render's, which is 'light' while hydrating.
  useEffect(() => { f7ready(() => f7.setDarkMode(currentAppearance() !== 'light')); }, [appearance]);
  // Hide the floating buttons while the feed scrolls, bring them back when it settles.
  useEffect(() => {
    let t: number | undefined;
    const on = () => { setFabHidden(true); clearTimeout(t); t = window.setTimeout(() => setFabHidden(false), 700); };
    document.addEventListener('scroll', on, true);
    return () => { document.removeEventListener('scroll', on, true); clearTimeout(t); };
  }, []);


  /* The dock (tab bar, side tab bar, rail and sidebar all share it): Feeds, Discover, Groups, Activity, and the
     person's avatar for their profile. */
  const dock: { id: string; label: string; ios: string; md: string; avatar?: string }[] = [
    { id: 'tab-feeds', label: 'Feeds', ios: 'f7:rectangle_stack', md: 'material:dynamic_feed' },
    { id: 'tab-discover', label: 'Discover', ios: 'f7:compass', md: 'material:explore' },
    { id: 'tab-groups', label: 'Groups', ios: 'f7:person_3', md: 'material:groups' },
    { id: 'tab-activity', label: 'Activity', ios: 'f7:bell', md: 'material:notifications_none' },
    { id: 'tab-profile', label: 'Profile', ios: 'f7:person_crop_circle', md: 'material:account_circle', avatar: auth.user ? (identity.avatar ?? undefined) : undefined },
  ];

  // Wide windows (and folded spans) mirror the desktop Discover page.
  const wide = profile.panes !== 'single';
  return (
    <App theme={theme} name="Atlas" colors={{ primary: accentHex(accent) }}>
      <Panel left cover swipe resizable={false} visibleBreakpoint={panelHeldAtStart ? 1 : undefined} className="atlas-panel">
        <Page>
          <Block className="atlas-brand" style={{ fontFamily: 'Instrument Serif, serif', fontStyle: 'italic', fontSize: 32, marginTop: 24 }}>Atlas</Block>
          <List strong inset dividers>
            {dock.map(d => (
              <ListItem key={d.id} link="#" panelClose title={d.label} selected={title === d.label} onClick={() => showTab(d.id)} {...(d.id === 'tab-activity' && unread ? { badge: unread, badgeColor: 'red' } : {})}>
                {d.avatar ? <img slot="media" className="atlas-dock-avatar" src={d.avatar} alt="" width={28} height={28} /> : <Icon slot="media" ios={d.ios} md={d.md} />}
              </ListItem>
            ))}
          </List>
          <List strong inset dividers>
            <ListItem link="#" panelClose title="Settings" selected={title === 'Settings'} onClick={() => showTab('tab-settings')}>
              <Icon slot="media" ios="f7:gear_alt" md="material:settings" />
            </ListItem>
          </List>
        </Page>
      </Panel>
      {/* The tab bar sits at view level so it stays on screen over pushed pages, as in other social apps. Pushed pages
          (a hashtag's feed) go in the stack view laid over the tabs: back with the chevron or a swipe from the left
          edge, on both themes (navigation.ts explains why it is a view of its own). */}
      <View main>
        <Toolbar tabbar icons bottom className="atlas-tabbar">
          {dock.map(d => (
            <Link key={d.id} tabLink={`#${d.id}`} tabLinkActive={d.id === 'tab-discover'} onClick={popToRoot} aria-label={d.avatar ? 'Your profile' : d.id === 'tab-activity' && unread ? `Activity, ${unread} unread` : undefined}>
              {d.avatar ? <img className="icon atlas-dock-avatar" src={d.avatar} alt="" width={28} height={28} /> : <Icon ios={d.ios} md={d.md}>{d.id === 'tab-activity' && unread && <Badge color="red" aria-hidden="true">{unread}</Badge>}</Icon>}
              <span className="tabbar-label">{d.label}</span>
            </Link>
          ))}
        </Toolbar>
        <View className="atlas-stack" url="/" routes={STACK_ROUTES} iosSwipeBack mdSwipeBack />
        <Page pageContent={false}>
          <Navbar title={title}>
            <NavLeft className="atlas-nav-menu">
              <Link iconOnly panelOpen="left" aria-label="Open menu"><Icon ios="f7:sidebar_left" md="material:menu" /></Link>
            </NavLeft>
            {['Discover', 'Feeds', 'Groups', 'Activity'].includes(title) && (
              <NavRight className="atlas-top-actions">
                {/* Facebook-style: Search and Messages at the top right; Compose floats at the bottom. */}
                <Link iconOnly className="atlas-top-btn" aria-label="Search" onClick={openSearch}><Icon ios="f7:search" md="material:search" /></Link>
                <Link iconOnly className="atlas-top-btn" aria-label="Messages" onClick={() => setMessagesOpen(true)}><Icon ios="f7:bubble_left_bubble_right" md="material:forum" /></Link>
              </NavRight>
            )}
            {title === 'Profile' && (
              <NavRight>
                <Link iconOnly aria-label="Settings" onClick={() => showTab('tab-settings')}>
                  <Icon ios="f7:gear_alt" md="material:settings" />
                </Link>
              </NavRight>
            )}
          </Navbar>
          <Fab position="right-bottom" slot="fixed" className="atlas-fab" aria-label="Compose" onClick={() => setComposeOpen(true)}
            style={{ marginBottom: 'calc(var(--f7-toolbar-height) + var(--f7-safe-area-bottom) + var(--atlas-player-offset, 0px))', transition: 'transform .25s, opacity .25s', transform: fabHidden ? 'translateY(120px)' : 'none', opacity: fabHidden ? 0 : 1 }}>
            <Icon ios="f7:square_pencil" md="material:edit" />
          </Fab>
          {assistantEnabled && (
            <Fab position="left-bottom" slot="fixed" color="white" className="atlas-fab" aria-label="Open assistant" onClick={() => setChatOpen(true)}
              style={{ marginBottom: 'calc(var(--f7-toolbar-height) + var(--f7-safe-area-bottom) + var(--atlas-player-offset, 0px))', transition: 'transform .25s, opacity .25s', transform: fabHidden ? 'translateY(120px)' : 'none', opacity: fabHidden ? 0 : 1 }}>
              <Icon ios="f7:sparkles" md="material:auto_awesome" />
            </Fab>
          )}
          <Tabs>
            <Tab id="tab-discover" className="page-content atlas-discover" onTabShow={() => setTitle('Discover')} tabActive>
              {/* Phones: one column. Wide windows mirror the desktop Discover page (main feed + "Voices to know"
                  column); when folded, the feed sits on one screen and the voices on the other. */}
              {wide && (
                <div className="atlas-hero">
                  <p className="atlas-hero-eyebrow"><span className="social-status-dot" />Discover the open social web</p>
                  <h1>A world of independent voices.</h1>
                  <p>Find creators, fresh perspectives, and conversations beyond your usual circle.</p>
                </div>
              )}
              <div className="atlas-d-main">
                <Searchbar placeholder="Search posts" disableButton={false} onInput={(e: any) => setQuery(e.target.value)} onClickClear={() => setQuery('')} />
                <MobilePostSearch q={query} />
                {!query.trim() && <>
                  <Block className="px-3"><GatewayDiscovery /></Block>
                  {wide ? <Block className="atlas-d-spotlight"><div className="atlas-desktop-embed"><Spotlight /></div></Block> : <MobileSpotlight />}
                  <MobileRecentArticles />
                </>}
                {!wide && <MobileVoicesToKnow />}
              </div>
              {wide && (
                <aside className="atlas-d-rail" aria-label="Creator discovery">
                  <BlockTitle className="atlas-rail-title">Voices to know</BlockTitle>
                  <Block><div className="atlas-desktop-embed"><VoicesToKnow /></div></Block>
                </aside>
              )}
            </Tab>

            <Tab id="tab-feeds" className="page-content" onTabShow={() => { setTitle('Feeds'); setFeedsShown(true); }} onTabHide={() => setFeedsShown(false)}>
              <MobileFeeds visible={feedsShown} />
            </Tab>

            <Tab id="tab-groups" className="page-content" onTabShow={() => setTitle('Groups')}>
              <MobileGroups onOpen={setGroupOpen} />
            </Tab>

            <Tab id="tab-activity" className="page-content" onTabShow={() => { setTitle('Activity'); setActivityShown(true); }} onTabHide={() => setActivityShown(false)}>
              <MobileActivity visible={activityShown} />
            </Tab>

            <Tab id="tab-profile" className="page-content" onTabShow={() => setTitle('Profile')}>
              <ProfileView onEditProfile={() => setEditProfileOpen(true)} onOpenCollection={c => setCollectionOpen({ collection: c })} />
            </Tab>

            <Tab id="tab-settings" className="page-content" onTabShow={() => setTitle('Settings')}>
              <MobileSettingsList />
              <Block>
                <Chip text={theme === 'ios' ? 'iOS design' : 'Material 3 design'} />
                <p style={{ opacity: 0.6, fontSize: 13 }}>
                  This device: {describeProfile(profile)} · {profile.layout} layout · {profile.width}×{profile.height}
                  {profile.span !== 'none' ? ` · screen spanned (${profile.span})` : ''}
                </p>
                <p style={{ opacity: 0.6, fontSize: 13 }}>Tip: use Share → Add to Home Screen to install Atlas.</p>
                <Link external href="/">Open the classic Atlas site</Link>
              </Block>
            </Tab>
          </Tabs>
        </Page>
      </View>
      <EditProfileSheet opened={editProfileOpen} onClose={() => setEditProfileOpen(false)} />
      <GroupPopup group={groupOpen} onClose={() => setGroupOpen(null)} onOpen={setGroupOpen} />
      <CollectionPopup opened={!!collectionOpen} onClose={() => setCollectionOpen(null)} collection={collectionOpen?.collection} id={collectionOpen?.id} link={collectionOpen?.link} />
      <ComposeSheet opened={composeOpen} onClose={() => setComposeOpen(false)} />
      <MessagesPopup opened={messagesOpen} onClose={() => setMessagesOpen(false)} />
      <FediProfilePopup target={fediProfile.target} onClose={fediProfile.close} />
      <MiniPlayer />
      <VideoDock />
      <SemanticIndexer />
      <LiveUpdates />
      {assistantEnabled && <AssistantPopup opened={chatOpen} onClose={() => setChatOpen(false)} />}
    </App>
  );
}

/** The stack's empty root: transparent, so the tabs show through when nothing is pushed. */
function StackRoot() {
  return <Page className="atlas-stack-root" />;
}

const STACK_ROUTES = [
  { path: '/', component: StackRoot },
  { path: '/tag/:tag/', component: TagFeedPage },
  { path: '/post/:id/', component: ThreadPage },
  { path: '/followed-tags/', component: FollowedTagsPage },
  { path: '/follow-requests/', component: FollowRequestsPage },
  { path: '/intelligence/', component: IntelligencePage },
  { path: '/notifications-settings/', component: NotificationSettingsPage },
  { path: '/keyword-filters/', component: KeywordFiltersPage },
  { path: '/keyword-filters/:id/', component: KeywordFilterPage },
  { path: '/appearance/', component: AppearancePage },
  { path: '/moderation/', component: ModerationPage },
  { path: '/moderation-suggestions/', component: MobileModerationSuggestionsPage },
  { path: '/blocked-people/', component: BlockedPeoplePage },
  { path: '/muted-people/', component: MutedPeoplePage },
  { path: '/import/', component: MobileImportPage },
];
