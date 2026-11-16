import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import { ArrowUpRight, ChevronRight, KeyRound, ShieldCheck, Smartphone, Server, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { PROVIDERS, PROVIDER_IDS, type ProviderId } from '@/lib/intelligence/providers';
import { BROWSER_CAPABLE } from '@/lib/intelligence/llm';
import { intelligenceReady, useIntelligence, useIntelligenceActions } from './useIntelligence';
import { useAtlasAuth } from './AuthState';
import { useSocial } from './SocialState';

export const DEVICE_KEY_NOTE = 'Never sent to Atlas: this browser calls the provider itself. But anything running in Atlas’s page could read it (an injected script or a browser extension), Safari may clear it after 7 days without a visit unless Atlas is on your Home Screen, and you’ll enter it again on each device. The assistant needs a key on Atlas’s server.';

/** Desktop: Settings → Intelligence. Opt-in AI with the person's own key from the provider they choose. */
export function IntelligenceSettings() {
  const { user } = useAtlasAuth();
  const social = useSocial();
  const q = useIntelligence();
  const act = useIntelligenceActions();
  const s = q.data;
  const ready = intelligenceReady(s);
  const [adding, setAdding] = useState<ProviderId | null>(null);

  if (!user) return <p className="mt-6 text-sm text-muted-foreground">Sign in to Atlas to use Intelligence.</p>;
  if (q.isLoading) return <p className="mt-6 text-sm text-muted-foreground">Loading…</p>;
  if (!s?.available) return <p className="mt-6 text-sm text-muted-foreground">Intelligence isn’t set up on this Atlas server yet.</p>;

  const active = s.active;
  const activeModels = active ? (active.where === 'device' ? s.deviceKeys : s.keys).find(k => k.provider === active.provider)?.models ?? [] : [];
  return <div className="mt-3">
    <p className="text-sm text-muted-foreground">Atlas works fully without AI.</p>

    <Row title="Use AI in Atlas" detail="With your own key, from the provider you choose. A provider only receives what a feature needs: posts your filters are checking, your filter list when you ask for suggestions, and what you type to the assistant. Direct messages are never sent." id="ai-enabled">
      <Switch aria-label="Use AI in Atlas" aria-describedby="ai-enabled" checked={s.enabled} disabled={act.busy} onCheckedChange={v => void act.update({ enabled: v })} />
    </Row>

    <section className="border-b border-border py-6">
      <h2 className="text-base font-semibold">Providers</h2>
      <p className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground"><ShieldCheck className="size-4 shrink-0" />Keys on Atlas’s server are encrypted there, never shown again, and only ever sent to their own provider.</p>
      <ul className="mt-4 divide-y divide-border rounded-2xl border border-border">
        {PROVIDER_IDS.map(id => {
          const p = PROVIDERS[id];
          const saved = [
            ...s.keys.filter(k => k.provider === id).map(k => ({ ...k, where: 'server' as const })),
            ...s.deviceKeys.filter(k => k.provider === id).map(k => ({ ...k, where: 'device' as const })),
          ];
          return <li key={id} className="p-4">
            <div className="flex flex-wrap items-center gap-3">
              <KeyRound className="size-4 text-muted-foreground" aria-hidden="true" />
              <span className="min-w-0 flex-1"><span className="block text-sm font-semibold">{p.product}</span><span className="block text-xs text-muted-foreground">{p.name}</span></span>
              <Button variant="outline" size="sm" className="rounded-full" onClick={() => setAdding(adding === id ? null : id)}>{saved.length ? 'Add or replace key' : 'Add key'}</Button>
            </div>
            {saved.map(k => <div key={k.where} className="mt-3 flex items-center gap-3 pl-7 text-sm">
              <input type="radio" name="ai-key" aria-label={`Use the ${p.product} key on ${k.where === 'device' ? 'this device' : 'Atlas’s server'}`} className="size-4 accent-[var(--accent)]"
                checked={active?.provider === id && active.where === k.where} disabled={act.busy} onChange={() => void act.choose(id, k.where)} />
              {k.where === 'device' ? <Smartphone className="size-4 text-muted-foreground" aria-hidden="true" /> : <Server className="size-4 text-muted-foreground" aria-hidden="true" />}
              <span className="min-w-0 flex-1 text-muted-foreground">{k.where === 'device' ? 'On this device' : 'On Atlas’s server'} · key {k.hint}</span>
              <Button variant="ghost" size="icon" aria-label={`Remove the ${p.product} key on ${k.where === 'device' ? 'this device' : 'Atlas’s server'}`} disabled={act.busy} onClick={() => void act.removeKey(id, k.where)}><Trash2 /></Button>
            </div>)}
            {adding === id && <KeyForm provider={id} serverKeys={s.serverKeys} onDone={() => setAdding(null)} />}
          </li>;
        })}
      </ul>
      {active && <label className="mt-4 flex flex-wrap items-center gap-3 text-sm">
        <span className="font-semibold">Model</span>
        <select className="h-9 min-w-0 flex-1 rounded-md border border-input bg-background px-3 text-sm" value={active.model} disabled={act.busy} onChange={e => void act.choose(active.provider, active.where, e.target.value)}>
          {activeModels.map(m => <option key={m} value={m}>{m}</option>)}
        </select>
      </label>}
      {active && <p className="mt-2 text-xs text-muted-foreground">The first model listed is a fast, inexpensive one, which suits filters and suggestions.</p>}
    </section>

    <Row title="Assistant" detail={active?.where === 'device' ? 'Ask Atlas from Compose. Needs a key on Atlas’s server.' : 'Ask Atlas from Compose.'} id="ai-assistant">
      <Switch aria-label="Assistant" aria-describedby="ai-assistant" checked={social.assistantEnabled && ready && active?.where === 'server'} disabled={!ready || active?.where !== 'server'} onCheckedChange={social.setAssistantEnabled} />
    </Row>
    <Row title="Check every post against topic filters" detail="Filters normally check only posts whose words match. This also catches posts on a topic that use none of its words, but sends every public post you scroll past to your provider." id="ai-deep">
      <Switch aria-label="Check every post against topic filters" aria-describedby="ai-deep" checked={s.deepMatching} disabled={!ready || act.busy} onCheckedChange={v => void act.update({ deepMatching: v })} />
    </Row>
    <Button asChild variant="ghost" className="h-auto w-full justify-start rounded-none border-b border-border py-5"><Link to="/settings/moderation"><span className="flex-1 text-left">Keyword filters</span><ChevronRight /></Link></Button>
  </div>;
}

function Row({ title, detail, id, children }: { title: string; detail: string; id: string; children: React.ReactNode }) {
  return <div className="flex items-start justify-between gap-6 border-b border-border py-6">
    <div><h2 className="text-base font-semibold">{title}</h2><p id={id} className="mt-1 text-sm leading-relaxed text-muted-foreground">{detail}</p></div>
    {children}
  </div>;
}

function KeyForm({ provider, serverKeys, onDone }: { provider: ProviderId; serverKeys: boolean; onDone: () => void }) {
  const act = useIntelligenceActions();
  const p = PROVIDERS[provider];
  const canDevice = BROWSER_CAPABLE[provider];
  const [where, setWhere] = useState<'server' | 'device'>(serverKeys ? 'server' : 'device');
  const [key, setKey] = useState(''), [account, setAccount] = useState(''), [error, setError] = useState<string | null>(null);
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const err = await act.saveKey(provider, key.trim(), p.needsAccount ? account.trim() : undefined, where);
    if (err) { setError(err); return; }
    setKey(''); onDone();
  };
  return <form className="mt-4 space-y-3 pl-7" onSubmit={save} autoComplete="off">
    <fieldset className="space-y-2 text-sm">
      <legend className="sr-only">Where to keep the key</legend>
      <label className="flex items-start gap-2"><input type="radio" name={`where-${provider}`} className="mt-1 accent-[var(--accent)]" checked={where === 'server'} disabled={!serverKeys} onChange={() => setWhere('server')} />
        <span><span className="font-medium">On Atlas’s server</span>{serverKeys ? ' (recommended)' : ''}<span className="block text-xs text-muted-foreground">{serverKeys ? 'Encrypted, never shown again, can’t be read by the page. Works on every device you sign in on.' : 'This Atlas server isn’t set up to keep keys.'}</span></span></label>
      <label className="flex items-start gap-2"><input type="radio" name={`where-${provider}`} className="mt-1 accent-[var(--accent)]" checked={where === 'device'} disabled={!canDevice} onChange={() => setWhere('device')} />
        <span><span className="font-medium">On this device only</span><span className="block text-xs text-muted-foreground">{canDevice ? DEVICE_KEY_NOTE : `${p.name}’s API doesn’t accept requests from a browser, so this key has to stay on Atlas’s server.`}</span></span></label>
    </fieldset>
    {p.needsAccount && <Input value={account} onChange={e => setAccount(e.target.value)} placeholder="Account ID (32 characters, on your Cloudflare dashboard)" aria-label="Cloudflare account ID" spellCheck={false} autoCapitalize="off" />}
    <div className="flex gap-2">
      <Input type="password" value={key} onChange={e => setKey(e.target.value)} placeholder={p.keyPlaceholder} aria-label={`${p.product} API key`} spellCheck={false} autoCapitalize="off" autoComplete="off" data-1p-ignore data-lpignore="true" />
      <Button type="submit" disabled={act.busy || key.trim().length < 16 || (p.needsAccount && !account.trim())}>{act.busy ? 'Checking…' : 'Save'}</Button>
    </div>
    <a href={p.keyUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground hover:underline">Get a {p.name} key<ArrowUpRight className="size-3" /></a>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
  </form>;
}
