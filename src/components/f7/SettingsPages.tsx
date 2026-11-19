import { Block, BlockFooter, BlockTitle, Icon, List, ListItem, Navbar, Page } from 'framework7-react';
import { AccentPicker } from '@/components/social/AccentPicker';
import { AvatarShapePicker } from '@/components/social/AvatarShapePicker';
import { pushPage } from './navigation';
import { MobileReadingSettings } from './ReadingSettings';
import { setThemeMode, useThemeMode } from './theme-mode';

/**
 * Phone Settings: the same categories, in the same order, as desktop's /settings — Intelligence, Notifications,
 * Appearance, Moderation, Followed hashtags — each its own pushed page (Apple's Settings pattern: a list that drills
 * into leaf pages), so a setting is in the same place on either.
 */
const CATEGORIES = [
  { url: '/intelligence/', title: 'Intelligence', ios: 'f7:sparkles', md: 'material:auto_awesome' },
  { url: '/notifications-settings/', title: 'Notifications', ios: 'f7:bell', md: 'material:notifications_none' },
  { url: '/appearance/', title: 'Appearance', ios: 'f7:paintbrush', md: 'material:palette' },
  { url: '/moderation/', title: 'Moderation', ios: 'f7:shield_lefthalf_fill', md: 'material:shield' },
  { url: '/followed-tags/', title: 'Followed hashtags', ios: 'f7:tag', md: 'material:sell' },
] as const;

export function MobileSettingsList() {
  return <List strong inset dividers>
    {CATEGORIES.map(c => <ListItem key={c.url} link="#" title={c.title} onClick={() => pushPage(c.url)}>
      <Icon slot="media" ios={c.ios} md={c.md} />
    </ListItem>)}
  </List>;
}

/** Settings → Appearance (desktop /settings/appearance): theme, accent, avatars, then reading and posting. */
export function AppearancePage() {
  const mode = useThemeMode();
  return <Page>
    <Navbar title="Appearance" backLink backLinkShowText={false} />
    <BlockTitle>Color theme</BlockTitle>
    <List strong inset dividers>
      <ListItem title="Light" radio radioIcon="end" name="mode" checked={mode === 'light'} onChange={() => setThemeMode('light')} />
      <ListItem title="Dark" radio radioIcon="end" name="mode" checked={mode === 'dark'} onChange={() => setThemeMode('dark')} />
      <ListItem title="Match device" radio radioIcon="end" name="mode" checked={mode === 'system'} onChange={() => setThemeMode('system')} />
    </List>
    <BlockTitle>Accent color</BlockTitle>
    <Block strong inset><AccentPicker /></Block>
    <BlockFooter>Used for buttons, the podcast player and highlights.</BlockFooter>
    <BlockTitle>Avatars</BlockTitle>
    <Block strong inset><AvatarShapePicker /></Block>
    <BlockFooter>How people, groups and podcasts are pictured across Atlas.</BlockFooter>
    <MobileReadingSettings />
  </Page>;
}
