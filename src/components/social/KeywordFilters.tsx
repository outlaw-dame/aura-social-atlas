import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import { ArrowUpRight, Plus, Sparkles, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { FEDIZEN_KEYWORD_FILTERS_URL } from '@/lib/fedizen-feed';
import { parseFilterList, type ContentFilter, type FilterAction } from '@/lib/content-filter';
import { AI_PROBLEM, intelligenceReady, useContentFilters, useFilterActions, useFilterCautions, useIntelligence } from './useIntelligence';
import { useAtlasAuth } from './AuthState';

type Suggestions = { suggestions: { text: string; reason: string }[]; cautions: { filterId: string; issue: string }[] };

/**
 * Desktop: Settings → Moderation → Keyword filters, kept by Atlas and applied in every Atlas feed. Words, phrases,
 * #hashtags or a topic in plain words; with Intelligence on, each is checked in context and widened by the AI model.
 */
export function KeywordFilters() {
  const { user } = useAtlasAuth();
  const q = useContentFilters();
  const ai = intelligenceReady(useIntelligence().data);
  const act = useFilterActions();
  const filters = q.data && 'filters' in q.data ? q.data.filters : [];
  const cautions = useFilterCautions(filters);
  const [text, setText] = useState(''), [action, setAction] = useState<FilterAction>('hide');
  const [note, setNote] = useState<string | null>(null), [busy, setBusy] = useState(false), [thinking, setThinking] = useState(false);
  const [suggested, setSuggested] = useState<Suggestions | null>(null), [importing, setImporting] = useState(false), [pasted, setPasted] = useState('');

  if (!user) return <p className="text-sm text-muted-foreground">Sign in to Atlas to keep keyword filters.</p>;
  if (q.data && 'error' in q.data) return <p className="text-sm text-muted-foreground">{AI_PROBLEM[q.data.error]}</p>;

  const add = async (texts: string[], how = action) => {
    if (!texts.length) return;
    setBusy(true); setNote(await act.add(texts, how)); setBusy(false);
  };
  const aiCautions = new Map<string, string[]>();
  for (const c of suggested?.cautions ?? []) aiCautions.set(c.filterId, [...(aiCautions.get(c.filterId) ?? []), c.issue]);

  return <div>
    <form className="flex flex-wrap gap-2" onSubmit={async e => { e.preventDefault(); await add([text]); setText(''); }}>
      <Input className="min-w-56 flex-1" value={text} onChange={e => setText(e.target.value)} maxLength={200} placeholder="A word, phrase, #hashtag or topic" aria-label="New keyword filter" />
      <select className="h-9 rounded-md border border-input bg-background px-3 text-sm" value={action} onChange={e => setAction(e.target.value as FilterAction)} aria-label="What to do with matching posts">
        <option value="hide">Hide</option>
        <option value="warn">Hide behind a warning</option>
      </select>
      <Button type="submit" variant="outline" disabled={!text.trim() || busy}><Plus />Add</Button>
    </form>
    <p className="mt-2 text-xs text-muted-foreground">Add * to catch longer words too: spam* also hides spammer.{ai ? ' Describe a topic in a few words to filter it whatever words a post uses.' : ''}</p>
    {note && <p role="alert" className="mt-2 text-sm text-destructive">{note}</p>}

    {q.isLoading ? <p className="mt-4 text-sm text-muted-foreground">Loading…</p>
      : <ul className="mt-4 divide-y divide-border">
          {filters.map(f => <FilterRow key={f.id} filter={f} ai={ai} cautions={[...(cautions.get(f.id) ?? []), ...(aiCautions.get(f.id) ?? [])]} />)}
          {!filters.length && <li className="py-3 text-sm text-muted-foreground">No keyword filters yet.</li>}
        </ul>}

    <div className="mt-4 flex flex-wrap gap-2">
      {ai && filters.length > 0 && <Button variant="outline" className="rounded-full" disabled={thinking} onClick={async () => {
        setThinking(true); setNote(null);
        const r = await act.suggest();
        setThinking(false);
        if ('error' in r) setNote(AI_PROBLEM[r.error]); else setSuggested(r);
      }}><Sparkles />{thinking ? 'Thinking…' : 'Suggest filters'}</Button>}
      <Button variant="ghost" className="rounded-full" onClick={() => setImporting(v => !v)}>Import from Fedizen</Button>
      {!ai && <Button asChild variant="ghost" className="rounded-full"><Link to="/settings/intelligence"><Sparkles />Check filters in context</Link></Button>}
    </div>

    {suggested && <section className="mt-4 rounded-2xl border border-border p-4" aria-label="Suggested filters">
      {suggested.suggestions.length
        ? <ul className="space-y-3">{suggested.suggestions.map(s => <li key={s.text} className="flex items-start gap-3">
            <span className="min-w-0 flex-1"><span className="block text-sm font-semibold">{s.text}</span><span className="block text-xs text-muted-foreground">{s.reason}</span></span>
            <Button size="sm" variant="outline" className="rounded-full" disabled={busy || filters.some(f => f.text.toLowerCase() === s.text.toLowerCase())} onClick={() => void add([s.text])}>{filters.some(f => f.text.toLowerCase() === s.text.toLowerCase()) ? 'Added' : 'Add'}</Button>
          </li>)}</ul>
        : <p className="text-sm text-muted-foreground">Your filters already cover their topics well.</p>}
      <Button variant="ghost" size="sm" className="mt-3" onClick={() => setSuggested(null)}>Done</Button>
    </section>}

    {importing && <section className="mt-4 rounded-2xl border border-border p-4" aria-label="Import from Fedizen">
      <p className="text-sm text-muted-foreground">Copy your list from Fedizen’s Safety settings and paste it here, one per line. Then remove them on Fedizen: it matches words without context, so it would still hide posts Atlas lets through.</p>
      <textarea className="mt-3 min-h-28 w-full rounded-md border border-input bg-background p-3 text-sm" value={pasted} onChange={e => setPasted(e.target.value)} aria-label="Filters to import" />
      <div className="mt-2 flex flex-wrap gap-2">
        <Button disabled={!parseFilterList(pasted).length || busy} onClick={async () => { await add(parseFilterList(pasted)); setPasted(''); setImporting(false); }}>Import {parseFilterList(pasted).length || ''}</Button>
        <Button asChild variant="ghost"><a href={FEDIZEN_KEYWORD_FILTERS_URL} target="_blank" rel="noopener noreferrer">Open Fedizen’s Safety settings<ArrowUpRight /></a></Button>
      </div>
    </section>}
  </div>;
}

function FilterRow({ filter: f, ai, cautions }: { filter: ContentFilter; ai: boolean; cautions: string[] }) {
  const act = useFilterActions();
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<unknown>) => { setBusy(true); try { await fn(); } finally { setBusy(false); } };
  return <li className="py-3">
    <div className="flex flex-wrap items-center gap-3">
      <span className="min-w-0 flex-1 break-words text-sm font-semibold">{f.text}</span>
      <select className="h-8 rounded-md border border-input bg-background px-2 text-xs" value={f.action} disabled={busy} aria-label={`What “${f.text}” does`} onChange={e => void run(() => act.update(f.id, { action: e.target.value as FilterAction }))}>
        <option value="hide">Hide</option>
        <option value="warn">Warn</option>
      </select>
      {ai && <label className="flex items-center gap-2 text-xs text-muted-foreground">In context<Switch checked={f.semantic} disabled={busy} aria-label={`Check “${f.text}” in context`} onCheckedChange={v => void run(() => act.update(f.id, { semantic: v }))} /></label>}
      <Button variant="ghost" size="icon" aria-label={`Remove “${f.text}”`} disabled={busy} onClick={() => void run(() => act.remove(f.id))}><Trash2 /></Button>
    </div>
    {ai && f.semantic && f.expansions.length > 0 && <p className="mt-1 text-xs text-muted-foreground">Also catches {f.expansions.slice(0, 8).join(', ')}{f.expansions.length > 8 ? ` and ${f.expansions.length - 8} more` : ''}</p>}
    {!ai && f.kind === 'topic' && <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">A topic matches posts only with Intelligence on.</p>}
    {cautions.map(c => <p key={c} className="mt-1 text-xs text-amber-700 dark:text-amber-400">{c}</p>)}
  </li>;
}
