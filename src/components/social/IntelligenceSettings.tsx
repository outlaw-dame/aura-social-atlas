import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import { ArrowUpRight, ChevronRight, KeyRound, ShieldCheck, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { PROVIDERS, PROVIDER_IDS, type ProviderId } from '@/lib/intelligence/providers';
import { intelligenceReady, useIntelligence, useIntelligenceActions } from './useIntelligence';
import { useAtlasAuth } from './AuthState';
import { useSocial } from './SocialState';

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

  const active = s.keys.find(k => k.provider === s.provider);
  return <div className="mt-3">
    <p className="text-sm text-muted-foreground">Atlas works fully without AI.</p>

    <Row title="Use AI in Atlas" detail="With your own key, from the provider you choose. A provider only receives what a feature needs: posts your filters are checking, your filter list when you ask for suggestions, and what you type to the assistant. Direct messages are never sent." id="ai-enabled">
      <Switch aria-label="Use AI in Atlas" aria-describedby="ai-enabled" checked={s.enabled} disabled={act.busy} onCheckedChange={v => void act.update({ enabled: v })} />
    </Row>

    <section className="border-b border-border py-6">
      <h2 className="text-base font-semibold">Providers</h2>
      <p className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground"><ShieldCheck className="size-4 shrink-0" />Keys are encrypted on Atlas’s server, never shown again, and only ever sent to their own provider.</p>
      <ul className="mt-4 divide-y divide-border rounded-2xl border border-border">
        {PROVIDER_IDS.map(id => {
          const p = PROVIDERS[id], key = s.keys.find(k => k.provider === id);
          return <li key={id} className="p-4">
            <div className="flex flex-wrap items-center gap-3">
              {key
                ? <input type="radio" name="ai-provider" aria-label={`Use ${p.product}`} className="size-4 accent-[var(--accent)]" checked={s.provider === id} disabled={act.busy} onChange={() => void act.update({ provider: id })} />
                : <KeyRound className="size-4 text-muted-foreground" aria-hidden="true" />}
              <span className="min-w-0 flex-1"><span className="block text-sm font-semibold">{p.product}</span><span className="block text-xs text-muted-foreground">{p.name}{key ? ` · key ${key.hint}` : ''}</span></span>
              {key
                ? <>
                    <Button variant="ghost" size="sm" className="rounded-full" onClick={() => setAdding(adding === id ? null : id)}>Replace key</Button>
                    <Button variant="ghost" size="icon" aria-label={`Remove the ${p.product} key`} disabled={act.busy} onClick={() => void act.removeKey(id)}><Trash2 /></Button>
                  </>
                : <Button variant="outline" size="sm" className="rounded-full" onClick={() => setAdding(adding === id ? null : id)}>Add key</Button>}
            </div>
            {adding === id && <KeyForm provider={id} onDone={() => setAdding(null)} />}
          </li>;
        })}
      </ul>
      {active && <label className="mt-4 flex flex-wrap items-center gap-3 text-sm">
        <span className="font-semibold">Model</span>
        <select className="h-9 min-w-0 flex-1 rounded-md border border-input bg-background px-3 text-sm" value={s.model ?? ''} disabled={act.busy} onChange={e => void act.update({ model: e.target.value })}>
          {active.models.map(m => <option key={m} value={m}>{m}</option>)}
        </select>
      </label>}
      {active && <p className="mt-2 text-xs text-muted-foreground">The first model listed is a fast, inexpensive one, which suits filters and suggestions.</p>}
    </section>

    <Row title="Assistant" detail="Ask Atlas from Compose." id="ai-assistant">
      <Switch aria-label="Assistant" aria-describedby="ai-assistant" checked={social.assistantEnabled && ready} disabled={!ready} onCheckedChange={social.setAssistantEnabled} />
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

function KeyForm({ provider, onDone }: { provider: ProviderId; onDone: () => void }) {
  const act = useIntelligenceActions();
  const p = PROVIDERS[provider];
  const [key, setKey] = useState(''), [account, setAccount] = useState(''), [error, setError] = useState<string | null>(null);
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const err = await act.saveKey(provider, key.trim(), p.needsAccount ? account.trim() : undefined);
    if (err) { setError(err); return; }
    setKey(''); onDone();
  };
  return <form className="mt-4 space-y-3" onSubmit={save} autoComplete="off">
    {p.needsAccount && <Input value={account} onChange={e => setAccount(e.target.value)} placeholder="Account ID (32 characters, on your Cloudflare dashboard)" aria-label="Cloudflare account ID" spellCheck={false} autoCapitalize="off" />}
    <div className="flex gap-2">
      <Input type="password" value={key} onChange={e => setKey(e.target.value)} placeholder={p.keyPlaceholder} aria-label={`${p.product} API key`} spellCheck={false} autoCapitalize="off" autoComplete="off" data-1p-ignore data-lpignore="true" />
      <Button type="submit" disabled={act.busy || key.trim().length < 16 || (p.needsAccount && !account.trim())}>{act.busy ? 'Checking…' : 'Save'}</Button>
    </div>
    <a href={p.keyUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground hover:underline">Get a {p.name} key<ArrowUpRight className="size-3" /></a>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
  </form>;
}
