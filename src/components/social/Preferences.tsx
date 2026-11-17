import { Link } from '@tanstack/react-router';
import { ArrowLeft, Bell, ChevronRight, Moon, Palette, Sparkle, Sun, ShieldCheck, Tag } from 'lucide-react';
import { NotificationSettings } from './NotificationSettings';
import { FollowedHashtags } from './FollowedHashtags';
import { ModerationPage } from './ModerationPage';
import { IntelligenceSettings } from './IntelligenceSettings';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { AccentPicker } from './AccentPicker';
import { AvatarShapePicker } from './AvatarShapePicker';
import { ReadingSettings } from './ReadingSettings';
import { useSocial } from './SocialState';

export function Preferences({ page }: { page: 'settings' | 'intelligence' | 'appearance' | 'moderation' | 'hashtags' | 'notifications' }) {
  const state = useSocial();
  const title = page === 'settings' ? 'Settings' : page === 'intelligence' ? 'Intelligence' : page === 'moderation' ? 'Moderation' : page === 'hashtags' ? 'Followed hashtags' : page === 'notifications' ? 'Notifications' : 'Appearance';
  return <section className="max-w-2xl animate-float-up">
    {page !== 'settings' && <Button asChild variant="ghost" className="mb-5 px-0"><Link to="/settings"><ArrowLeft />Settings</Link></Button>}
    <h1 className="font-serif text-4xl leading-tight sm:text-5xl">{title}</h1>
    {page === 'settings' ? <nav aria-label="Settings categories" className="mt-8 divide-y divide-border border-y border-border">
      <Button asChild variant="ghost" className="h-auto w-full justify-start rounded-none py-5"><Link to="/settings/intelligence"><Sparkle /><span className="flex-1 text-left">Intelligence</span><ChevronRight /></Link></Button>
      <Button asChild variant="ghost" className="h-auto w-full justify-start rounded-none py-5"><Link to="/settings/notifications"><Bell /><span className="flex-1 text-left">Notifications</span><ChevronRight /></Link></Button>
      <Button asChild variant="ghost" className="h-auto w-full justify-start rounded-none py-5"><Link to="/settings/appearance"><Palette /><span className="flex-1 text-left">Appearance</span><ChevronRight /></Link></Button>
      <Button asChild variant="ghost" className="h-auto w-full justify-start rounded-none py-5"><Link to="/settings/moderation"><ShieldCheck /><span className="flex-1 text-left">Moderation</span><ChevronRight /></Link></Button>
      <Button asChild variant="ghost" className="h-auto w-full justify-start rounded-none py-5"><Link to="/settings/hashtags"><Tag /><span className="flex-1 text-left">Followed hashtags</span><ChevronRight /></Link></Button>
    </nav> : page === 'moderation' ? <ModerationPage /> : page === 'hashtags' ? <FollowedHashtags /> : page === 'notifications' ? <NotificationSettings /> : page === 'intelligence' ? <IntelligenceSettings /> : <div className="mt-8 border-y border-border py-6"><h2 className="mb-4 text-base font-semibold">Color theme</h2><div className="flex flex-wrap gap-3">{[{ dark: false, label: 'Light', icon: Sun }, { dark: true, label: 'Dark', icon: Moon }].map(t => <Button key={t.label} variant={state.dark === t.dark ? 'secondary' : 'outline'} aria-pressed={state.dark === t.dark} className={state.dark === t.dark ? 'ring-1 ring-ring' : ''} onClick={() => { if (state.dark !== t.dark) state.toggleDark(); }}><t.icon />{t.label}</Button>)}</div><h2 className="mb-1 mt-8 text-base font-semibold">Accent color</h2><p className="mb-4 text-sm text-muted-foreground">Used for buttons, the podcast player and highlights.</p><AccentPicker /><h2 className="mb-1 mt-8 text-base font-semibold">Avatars</h2><p className="mb-4 text-sm text-muted-foreground">How people, groups and podcasts are pictured across Atlas.</p><AvatarShapePicker /><ReadingSettings /></div>}
  </section>;
}