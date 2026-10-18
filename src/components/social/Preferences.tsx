import { Link } from '@tanstack/react-router';
import { ArrowLeft, ChevronRight, Moon, Palette, Sparkle, Sun } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { useSocial } from './SocialState';

export function Preferences({ page }: { page: 'settings' | 'intelligence' | 'appearance' }) {
  const state = useSocial();
  const title = page === 'settings' ? 'Settings' : page === 'intelligence' ? 'Intelligence' : 'Appearance';
  return <section className="max-w-2xl animate-float-up">
    {page !== 'settings' && <Button asChild variant="ghost" className="mb-5 px-0"><Link to="/settings"><ArrowLeft />Settings</Link></Button>}
    <h1 className="font-serif text-4xl leading-tight sm:text-5xl">{title}</h1>
    {page === 'settings' ? <nav aria-label="Settings categories" className="mt-8 divide-y divide-border border-y border-border">
      <Button asChild variant="ghost" className="h-auto w-full justify-start rounded-none py-5"><Link to="/settings/intelligence"><Sparkle /><span className="flex-1 text-left">Intelligence</span><ChevronRight /></Link></Button>
      <Button asChild variant="ghost" className="h-auto w-full justify-start rounded-none py-5"><Link to="/settings/appearance"><Palette /><span className="flex-1 text-left">Appearance</span><ChevronRight /></Link></Button>
    </nav> : page === 'intelligence' ? <>
      <p className="mt-3 text-sm text-muted-foreground">Atlas works fully without AI.</p>
      <div className="mt-8 flex items-start justify-between gap-6 border-y border-border py-6"><div><h2 className="text-base font-semibold">Atlas assistant</h2><p id="assistant-disclosure" className="mt-2 text-sm leading-relaxed text-muted-foreground">Available in Compose when enabled. Your messages are sent to an AI service to generate replies.</p></div><Switch aria-label="Atlas assistant" aria-describedby="assistant-disclosure" checked={state.assistantEnabled} onCheckedChange={state.setAssistantEnabled} /></div>
    </> : <div className="mt-8 border-y border-border py-6"><h2 className="mb-4 text-base font-semibold">Color theme</h2><div className="flex flex-wrap gap-3">{[{ dark: false, label: 'Light', icon: Sun }, { dark: true, label: 'Dark', icon: Moon }].map(t => <Button key={t.label} variant={state.dark === t.dark ? 'secondary' : 'outline'} aria-pressed={state.dark === t.dark} className={state.dark === t.dark ? 'ring-1 ring-ring' : ''} onClick={() => { if (state.dark !== t.dark) state.toggleDark(); }}><t.icon />{t.label}</Button>)}</div></div>}
  </section>;
}