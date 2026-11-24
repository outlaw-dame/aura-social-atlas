import { useRef, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { ArrowUpRight, Download, Pencil, Plus, Sparkles, Trash2, Upload, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { FEDIZEN_KEYWORD_FILTERS_URL } from '@/lib/fedizen-feed';
import { FILTER_PLACES, MAX_EXPANSIONS, type ContentFilter, type FilterAction, type FilterPlace } from '@/lib/content-filter';
import { AI_PROBLEM, DEFAULT_OPTIONS, intelligenceReady, useContentFilters, useFilterActions, useFilterCautions, useIntelligence, type FilterOptions } from './useIntelligence';
import { ACTION_LABEL, DURATIONS, PLACE_LABEL, downloadExport, expiresAfter, filterSummary, parseImport } from './filter-options';
import { useAtlasAuth } from './AuthState';
import { countLabel, totalLabel, useFilteredCounts } from '@/lib/filter-stats';

/** Something that may be wrong with a filter, and the words to change it to when there's a better choice. */
type Caution = { issue: string; replacement?: string };

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
  const counts = useFilteredCounts(user?.id);
  const [text, setText] = useState(''), [options, setOptions] = useState<FilterOptions>(DEFAULT_OPTIONS), [duration, setDuration] = useState(0), [more, setMore] = useState(false);
  const [note, setNote] = useState<string | null>(null), [busy, setBusy] = useState(false);
  const [importing, setImporting] = useState(false), [pasted, setPasted] = useState('');
  const file = useRef<HTMLInputElement>(null);

  if (!user) return <p className="text-sm text-muted-foreground">Sign in to Atlas to keep keyword filters.</p>;
  if (q.data && 'error' in q.data) return <p className="text-sm text-muted-foreground">{AI_PROBLEM[q.data.error]}</p>;

  const add = async (texts: string[], how: FilterOptions) => {
    if (!texts.length) return;
    setBusy(true); setNote(await act.add(texts, how)); setBusy(false);
  };
  const importText = async (raw: string) => {
    const groups = parseImport(raw);
    if (!groups.length) { setNote('Nothing to import there.'); return; }
    for (const g of groups) await add(g.texts, g.options);
    setPasted(''); setImporting(false);
  };
  return <div>
    <form className="flex flex-wrap gap-2" onSubmit={async e => { e.preventDefault(); await add([text], { ...options, expiresAt: expiresAfter(DURATIONS[duration].ms) }); setText(''); }}>
      <Input className="min-w-56 flex-1" value={text} onChange={e => setText(e.target.value)} maxLength={200} placeholder="A word, phrase, #hashtag or topic" aria-label="New keyword filter" />
      <ActionSelect value={options.action} onChange={a => setOptions(o => ({ ...o, action: a }))} />
      <Button type="submit" variant="outline" disabled={!text.trim() || busy}><Plus />Add</Button>
    </form>
    <button type="button" className="mt-2 text-xs text-muted-foreground underline-offset-2 hover:underline" aria-expanded={more} onClick={() => setMore(v => !v)}>{more ? 'Fewer options' : 'Where, how long, and for whom'}</button>
    {more && <OptionsEditor className="mt-3" options={options} onChange={setOptions} duration={duration} onDuration={setDuration} />}
    <p className="mt-2 text-xs text-muted-foreground">Add * to catch longer words too: spam* also hides spammer. A #hashtag matches only the hashtag; a word matches it as a hashtag too.{ai ? ' Describe a topic in a few words to filter it whatever words a post uses.' : ''}</p>
    {note && <p role="alert" className="mt-2 text-sm text-destructive">{note}</p>}

    {q.isLoading ? <p className="mt-4 text-sm text-muted-foreground">Loading…</p>
      : <>{filters.length > 0 && <p className="mt-4 text-sm text-muted-foreground">{totalLabel(filters, counts)}</p>}<ul className="mt-2 divide-y divide-border">
          {filters.map(f => <FilterRow key={f.id} filter={f} ai={ai} count={counts.get(f.id) ?? 0} cautions={(cautions.get(f.id) ?? []).map(issue => ({ issue }))} />)}
          {!filters.length && <li className="py-3 text-sm text-muted-foreground">No keyword filters yet.</li>}
        </ul></>}

    <div className="mt-4 flex flex-wrap gap-2">
      {ai && <Button asChild variant="outline" className="rounded-full"><a href="#suggestions"><Sparkles />Suggestions</a></Button>}
      <Button variant="ghost" className="rounded-full" onClick={() => setImporting(v => !v)}><Upload />Import</Button>
      {filters.length > 0 && <Button variant="ghost" className="rounded-full" onClick={() => downloadExport(filters)}><Download />Export</Button>}
      {!ai && <Button asChild variant="ghost" className="rounded-full"><Link to="/settings/intelligence"><Sparkles />Check filters in context</Link></Button>}
    </div>


    {importing && <section className="mt-4 rounded-2xl border border-border p-4" aria-label="Import filters">
      <p className="text-sm text-muted-foreground">Paste your list from Fedizen’s Safety settings, one per line, or a filter export from Mastodon (Preferences → Import and export). If you bring them over from Fedizen, remove them there: it matches words without context, so it would still hide posts Atlas lets through.</p>
      <textarea className="mt-3 min-h-28 w-full rounded-md border border-input bg-background p-3 text-sm" value={pasted} onChange={e => setPasted(e.target.value)} aria-label="Filters to import" />
      <div className="mt-2 flex flex-wrap gap-2">
        <Button disabled={!pasted.trim() || busy} onClick={() => void importText(pasted)}>Import</Button>
        <Button variant="outline" onClick={() => file.current?.click()}>Choose a file…</Button>
        <input ref={file} type="file" accept="application/json,.json,text/plain,.txt,.csv" className="hidden" onChange={async e => { const f = e.target.files?.[0]; e.target.value = ''; if (f && f.size < 2_000_000) await importText(await f.text()); }} />
        <Button asChild variant="ghost"><a href={FEDIZEN_KEYWORD_FILTERS_URL} target="_blank" rel="noopener noreferrer">Open Fedizen’s Safety settings<ArrowUpRight /></a></Button>
      </div>
    </section>}
  </div>;
}

function ActionSelect({ value, onChange, label = 'What to do with matching posts' }: { value: FilterAction; onChange: (a: FilterAction) => void; label?: string }) {
  return <select className="h-9 rounded-md border border-input bg-background px-3 text-sm" value={value} onChange={e => onChange(e.target.value as FilterAction)} aria-label={label}>
    {(['hide', 'warn', 'blur'] as const).map(a => <option key={a} value={a}>{ACTION_LABEL[a]}</option>)}
  </select>;
}

/** Where a filter applies, for how long, and whether it skips people you follow. */
function OptionsEditor({ options, onChange, duration, onDuration, className = '' }: { options: FilterOptions; onChange: (o: FilterOptions) => void; duration: number; onDuration: (i: number) => void; className?: string }) {
  const toggle = (p: FilterPlace) => {
    const next = options.places.includes(p) ? options.places.filter(x => x !== p) : [...options.places, p];
    if (next.length) onChange({ ...options, places: FILTER_PLACES.filter(x => next.includes(x)) });
  };
  return <div className={`grid grid-cols-[minmax(0,1fr)] gap-4 rounded-2xl border border-border p-4 text-sm sm:grid-cols-3 ${className}`}>
    <fieldset><legend className="mb-2 font-medium">Where</legend>
      {FILTER_PLACES.map(p => <label key={p} className="mb-1 flex items-center gap-2"><input type="checkbox" className="accent-[var(--accent)]" checked={options.places.includes(p)} onChange={() => toggle(p)} />{PLACE_LABEL[p]}</label>)}
    </fieldset>
    <label className="block"><span className="mb-2 block font-medium">For</span>
      <select className="h-9 w-full rounded-md border border-input bg-background px-3" value={duration} onChange={e => onDuration(Number(e.target.value))}>
        {duration < 0 && options.expiresAt && <option value={-1}>{Date.parse(options.expiresAt) <= Date.now() ? 'Expired' : `Until ${new Date(options.expiresAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`}</option>}
        {DURATIONS.map((d, i) => <option key={d.label} value={i}>{d.label}</option>)}
      </select>
    </label>
    <label className="flex items-start gap-2"><Switch checked={options.exceptFollowing} onCheckedChange={v => onChange({ ...options, exceptFollowing: v })} aria-label="Not from people I follow" /><span><span className="block font-medium">Not from people I follow</span><span className="text-xs text-muted-foreground">Their posts always show.</span></span></label>
  </div>;
}

function FilterRow({ filter: f, ai, count, cautions }: { filter: ContentFilter; ai: boolean; count: number; cautions: Caution[] }) {
  const act = useFilterActions();
  const [busy, setBusy] = useState(false), [editing, setEditing] = useState(false), [note, setNote] = useState<string | null>(null);
  const [words, setWords] = useState(f.text);
  // Any message an action returns (a refusal, a provider problem) shows under the filter.
  const run = async (fn: () => Promise<unknown>) => { setBusy(true); setNote(null); try { const r = await fn(); if (typeof r === 'string') setNote(r); } finally { setBusy(false); } };
  const rename = (text: string) => run(async () => { const why = await act.update(f.id, { text }); if (!why) setWords(text); return why; });
  const summary = filterSummary(f);
  return <li className="py-3">
    <div className="flex flex-wrap items-center gap-3">
      <span className="min-w-0 flex-1"><span className="block break-words text-sm font-semibold">{f.text}</span>{summary && <span className="block text-xs text-muted-foreground">{summary}</span>}<span className="block text-xs text-muted-foreground">{countLabel(count)}</span></span>
      {ai && <label className="flex items-center gap-2 text-xs text-muted-foreground">In context<Switch checked={f.semantic} disabled={busy} aria-label={`Check “${f.text}” in context`} onCheckedChange={v => void run(() => act.update(f.id, { semantic: v }))} /></label>}
      <Button variant="ghost" size="icon" aria-label={`Edit “${f.text}”`} aria-expanded={editing} onClick={() => setEditing(v => !v)}><Pencil /></Button>
      <Button variant="ghost" size="icon" aria-label={`Remove “${f.text}”`} disabled={busy} onClick={() => void run(() => act.remove(f.id))}><Trash2 /></Button>
    </div>
    {!editing && ai && f.semantic && f.expansions.length > 0 && <p className="mt-1 text-xs text-muted-foreground">Also catches {f.expansions.slice(0, 8).join(', ')}{f.expansions.length > 8 ? ` and ${f.expansions.length - 8} more` : ''}</p>}
    {!ai && f.kind === 'topic' && <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">A topic matches posts only through its wordings, which come with Intelligence.</p>}
    {cautions.map(c => <div key={c.issue} className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
      <p className="text-xs text-amber-700 dark:text-amber-400">{c.issue}</p>
      {c.replacement && <Button size="sm" variant="outline" className="h-7 rounded-full text-xs" disabled={busy} onClick={() => void rename(c.replacement!)}>Change to “{c.replacement}”</Button>}
    </div>)}
    {!editing && note && <p role="alert" className="mt-1 text-sm text-destructive">{note}</p>}
    {editing && <div className="mt-3 space-y-3">
      <form className="flex flex-wrap gap-2" onSubmit={e => { e.preventDefault(); if (words.trim() && words.trim() !== f.text) void rename(words); }}>
        <Input className="min-w-56 flex-1" value={words} onChange={e => setWords(e.target.value)} maxLength={200} aria-label={`Words for “${f.text}”`} placeholder="A word, phrase, #hashtag or topic" />
        <Button type="submit" variant="outline" disabled={busy || !words.trim() || words.trim() === f.text}>Save</Button>
      </form>
      {ai && f.semantic && <p className="text-xs text-muted-foreground">Changing the words starts its other wordings again.</p>}
      <div className="flex flex-wrap items-center gap-3"><ActionSelect value={f.action} label={`What “${f.text}” does`} onChange={a => void run(() => act.update(f.id, { action: a }))} /></div>
      <OptionsEditor options={{ action: f.action, places: f.places, expiresAt: f.expiresAt, exceptFollowing: f.exceptFollowing }} onChange={o => void run(() => act.update(f.id, { places: o.places, exceptFollowing: o.exceptFollowing }))}
        duration={f.expiresAt ? -1 : 0} onDuration={i => void run(() => act.update(f.id, { expiresAt: expiresAfter(DURATIONS[i].ms) }))} />
      <Wordings filter={f} ai={ai} busy={busy} onSave={list => run(() => act.update(f.id, { expansions: list }))} onAsk={() => run(async () => setNote(await act.widen(f.id)))} />
      {note && <p role="alert" className="text-sm text-destructive">{note}</p>}
    </div>}
  </li>;
}

/** The wordings a filter also catches: remove any you disagree with, add your own, or ask the AI model again. */
function Wordings({ filter: f, ai, busy, onSave, onAsk }: { filter: ContentFilter; ai: boolean; busy: boolean; onSave: (list: string[]) => Promise<void>; onAsk: () => Promise<void> }) {
  const [draft, setDraft] = useState('');
  return <div>
    <p className="mb-2 text-sm font-medium">Also catches</p>
    <ul className="flex flex-wrap gap-2">
      {f.expansions.map(w => <li key={w} className="flex items-center gap-1 rounded-full border border-border py-1 pl-3 pr-1 text-xs">
        {w}<button type="button" className="rounded-full p-0.5 hover:bg-muted" aria-label={`Stop catching “${w}”`} disabled={busy} onClick={() => void onSave(f.expansions.filter(x => x !== w))}><X className="size-3" /></button>
      </li>)}
      {!f.expansions.length && <li className="text-xs text-muted-foreground">Only its own words.</li>}
    </ul>
    <form className="mt-2 flex flex-wrap gap-2" onSubmit={async e => { e.preventDefault(); if (draft.trim()) { await onSave([...f.expansions, draft.trim()]); setDraft(''); } }}>
      <Input className="h-8 min-w-48 flex-1 text-xs" value={draft} onChange={e => setDraft(e.target.value)} maxLength={60} placeholder="Another word, phrase or #hashtag" aria-label={`Another wording for “${f.text}”`} disabled={f.expansions.length >= MAX_EXPANSIONS} />
      <Button type="submit" size="sm" variant="outline" disabled={busy || !draft.trim()}>Add</Button>
      {ai && <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => void onAsk()}><Sparkles />Ask again</Button>}
    </form>
  </div>;
}
