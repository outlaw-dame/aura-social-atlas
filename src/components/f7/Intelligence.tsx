import { useRef, useState } from 'react';
import { Block, BlockFooter, BlockTitle, Button, Link, List, ListInput, ListItem, Navbar, Page, Toggle, f7 } from 'framework7-react';
import { PROVIDERS, PROVIDER_IDS, type ProviderId } from '@/lib/intelligence/providers';
import { BROWSER_CAPABLE } from '@/lib/intelligence/llm';
import { FILTER_PLACES, MAX_EXPANSIONS, type FilterAction, type FilterPlace } from '@/lib/content-filter';
import { FEDIZEN_KEYWORD_FILTERS_URL } from '@/lib/fedizen-feed';
import { AI_PROBLEM, DEFAULT_OPTIONS, type KeyRef, intelligenceReady, whyUnavailable, useContentFilters, useFilterActions, useFilterCautions, useIntelligence, useIntelligenceActions, type FilterOptions } from '@/components/social/useIntelligence';
import { ACTION_LABEL, ACTION_SHORT, DURATIONS, PLACE_LABEL, downloadExport, expiresAfter, filterSummary, parseImport } from '@/components/social/filter-options';
import { DEVICE_KEY_NOTE, keyTitle } from '@/components/social/IntelligenceSettings';
import { useAtlasAuth } from '@/components/social/AuthState';
import { countLabel, totalLabel, useFilteredCounts } from '@/lib/filter-stats';
import { useSocial } from '@/components/social/SocialState';
import { pushPage } from './navigation';
import { MobileSemanticSettings } from './SemanticSettings';
import { MobileTranslationSettings } from './TranslationSettings';

/** Phone: Settings → Intelligence, a pushed page (swipe back). */
export function IntelligencePage() {
  const { user } = useAtlasAuth();
  const social = useSocial();
  const q = useIntelligence();
  const act = useIntelligenceActions();
  const s = q.data;
  const ready = intelligenceReady(s);
  const [adding, setAdding] = useState<ProviderId | null>(null);
  const active = s?.active ?? null;
  const models = !active || !s ? [] : active.where === 'device' ? s.deviceKeys.find(k => k.provider === active.provider)?.models ?? [] : s.keys.find(k => k.id === active.keyId)?.models ?? [];
  const saved: { ref: KeyRef; id: string; title: string; footer: string; chosen: boolean; label: string | null; embeddingsOnly: boolean }[] = s ? [
    ...s.keys.map(k => ({ ...k, where: 'server' as const })), ...s.deviceKeys.map(k => ({ ...k, where: 'device' as const })),
  ].map(k => ({
    ref: { where: k.where, keyId: k.id }, id: `${k.where}-${k.id}`, label: k.label, embeddingsOnly: !!PROVIDERS[k.provider].embeddingsOnly,
    title: PROVIDERS[k.provider].product + (k.label ? ` “${k.label}”` : ''),
    footer: `${k.where === 'device' ? 'On this device' : 'On Atlas’s server'} · key ${k.hint}`,
    chosen: active?.where === k.where && active.keyId === k.id,
  })) : [];
  const bgKey = s?.background ? s.keys.find(k => k.id === s.background!.key) : undefined;
  return <Page>
    <Navbar title="Intelligence" backLink backLinkShowText={false} />
    {!user ? <><Block strong inset>Sign in to Atlas to use Intelligence.</Block><MobileTranslationSettings /></>
      : q.isLoading ? <Block strong inset>Loading…</Block>
      : !s?.available ? <><Block strong inset>Intelligence isn’t set up on this Atlas server yet.</Block><MobileTranslationSettings /><MobileSemanticSettings /></>
      : <>
        <List strong inset dividers>
          <ListItem title="Use AI in Atlas"><Toggle slot="after" checked={s.enabled} disabled={act.busy} onToggleChange={() => void act.update({ enabled: !s.enabled })} /></ListItem>
        </List>
        <BlockFooter>Atlas works fully without AI. With your own key, a provider only receives what a feature needs: posts your filters are checking, your filter list when you ask for suggestions, and what you type to the assistant. Direct messages are never sent.</BlockFooter>

        <MobileTranslationSettings />

        {saved.length > 0 && <>
          <BlockTitle>Your keys</BlockTitle>
          <List strong inset dividers>
            {saved.filter(k => !k.embeddingsOnly).map(k => <ListItem key={k.id} radio radioIcon="end" name="ai-key" title={k.title} footer={k.footer} checked={k.chosen} onChange={() => void act.choose(k.ref)} />)}
          </List>
          <BlockTitle>Manage keys</BlockTitle>
          <List strong inset dividers>
            {saved.map(k => <ListItem key={`manage-${k.id}`} link="#" title={k.title} footer={k.footer}
              onClick={() => f7.actions.create({ buttons: [[
                { text: 'Name…', onClick: () => f7.dialog.prompt('A name to tell this key apart, like Work or Personal. Leave it empty for none.', 'Name key', (v: string) => void act.editKey(k.ref, { label: v.trim() ? v.trim().slice(0, 40) : null }), undefined, k.label ?? '') },
                { text: 'Remove', color: 'red', onClick: () => f7.dialog.confirm(`Remove ${k.title}?`, 'Remove key', () => void act.removeKey(k.ref)) },
              ], [{ text: 'Cancel', strong: true }]] }).open()} />)}
          </List>
        </>}

        <BlockTitle>Add a key</BlockTitle>
        <List strong inset dividers>
          {PROVIDER_IDS.filter(id => !PROVIDERS[id].embeddingsOnly).map(id => <ListItem key={id} link="#" title={PROVIDERS[id].product} footer={PROVIDERS[id].name !== PROVIDERS[id].product ? PROVIDERS[id].name : undefined} onClick={() => setAdding(id)} />)}
        </List>
        <BlockTitle>For semantic filters only</BlockTitle>
        <List strong inset dividers>
          {PROVIDER_IDS.filter(id => PROVIDERS[id].embeddingsOnly).map(id => <ListItem key={id} link="#" title={PROVIDERS[id].product} footer={PROVIDERS[id].name !== PROVIDERS[id].product ? PROVIDERS[id].name : undefined} onClick={() => setAdding(id)} />)}
        </List>
        <BlockFooter>These companies make embedding models, which semantic filters and search by meaning use to compare posts. Their keys aren’t used for anything else. When you have one, Atlas uses it for that.</BlockFooter>
        {adding && <KeyForm provider={adding} serverKeys={s.serverKeys} onDone={() => setAdding(null)} />}

        {active && <>
          <BlockTitle>Model</BlockTitle>
          <List strong inset>
            <ListInput type="select" value={active.model} onChange={e => void act.choose({ where: active.where, keyId: active.keyId! }, (e.target as HTMLSelectElement).value)}>
              {models.map(m => <option key={m} value={m}>{m}</option>)}
            </ListInput>
          </List>
        </>}

        {active && (active.where === 'server' ? s.keys : s.deviceKeys).length > 1 && <>
            <List strong inset dividers>
              <ListItem title="Use your other keys as backup"><Toggle slot="after" checked={s.fallback} disabled={act.busy} onToggleChange={() => void act.update({ fallback: !s.fallback })} /></ListItem>
            </List>
            <BlockFooter>If the key in use is refusing requests, or its provider is limiting it, Atlas tries your other keys{active.where === 'device' ? ' on this device' : ''} in the order you added them.</BlockFooter>
        </>}
        {active?.where === 'server' && <>
          <BlockTitle>Background filtering</BlockTitle>
          <List strong inset dividers>
            <ListInput type="select" label="Key" value={s.background?.key ?? ''} onChange={e => { const v = (e.target as HTMLSelectElement).value; void act.setBackground(v ? { key: v } : null); }}>
              <option value="">Same as main</option>
              {s.keys.map(k => <option key={k.id} value={k.id}>{keyTitle(k)}</option>)}
            </ListInput>
            {bgKey && <ListInput type="select" label="Model" value={s.background!.model} onChange={e => void act.setBackground({ key: bgKey.id, model: (e.target as HTMLSelectElement).value })}>
              {bgKey.models.map(m => <option key={m} value={m}>{m}</option>)}
            </ListInput>}
          </List>
          <BlockFooter>Keyword filters check posts as your feeds load. A separate key, or a smaller model, keeps that from using up what your main key needs.</BlockFooter>
        </>}

        <BlockTitle>Features</BlockTitle>
        <List strong inset dividers>
          <ListItem title="Assistant" footer={whyUnavailable(s, true) ?? 'A sparkle button opens chat.'}>
            <Toggle slot="after" checked={social.assistantEnabled && ready && active?.where === 'server'} disabled={!ready || active?.where !== 'server'} onToggleChange={() => social.setAssistantEnabled(!social.assistantEnabled)} />
          </ListItem>
          <ListItem title="Check every post against topic filters" footer={whyUnavailable(s) ?? "Also sends every public post you scroll past to your provider."}><Toggle slot="after" checked={s.deepMatching} disabled={!ready || act.busy} onToggleChange={() => void act.update({ deepMatching: !s.deepMatching })} /></ListItem>
          <ListItem link="#" title="Keyword filters" onClick={() => pushPage('/keyword-filters/')} />
        </List>
        <MobileSemanticSettings />
      </>}
  </Page>;
}

function KeyForm({ provider, serverKeys, onDone }: { provider: ProviderId; serverKeys: boolean; onDone: () => void }) {
  const act = useIntelligenceActions();
  const p = PROVIDERS[provider];
  const canDevice = BROWSER_CAPABLE[provider];
  const [where, setWhere] = useState<'server' | 'device'>(serverKeys ? 'server' : 'device');
  const [key, setKey] = useState(''), [account, setAccount] = useState(''), [label, setLabel] = useState(''), [error, setError] = useState<string | null>(null);
  const save = async () => {
    setError(null);
    const err = await act.saveKey(provider, key.trim(), p.needsAccount ? account.trim() : undefined, where, label);
    if (err) { setError(err); return; }
    setKey(''); onDone();
  };
  return <>
    <BlockTitle>{p.product} key</BlockTitle>
    <List strong inset dividers>
      <ListItem radio radioIcon="end" name="key-where" title="On Atlas’s server" footer={serverKeys ? 'Recommended. Encrypted, can’t be read by the page, works on every device.' : 'This Atlas server isn’t set up to keep keys.'} checked={where === 'server'} disabled={!serverKeys} onChange={() => setWhere('server')} />
      <ListItem radio radioIcon="end" name="key-where" title="On this device only" footer={canDevice ? DEVICE_KEY_NOTE : `${p.name}’s API doesn’t accept requests from a browser.`} checked={where === 'device'} disabled={!canDevice} onChange={() => setWhere('device')} />
    </List>
    <List strong inset>
 {<ListInput type="text" placeholder="Name (optional), like Work" value={label} maxlength={40} onInput={e => setLabel((e.target as HTMLInputElement).value)} />}
      {p.needsAccount && <ListInput type="text" placeholder="Cloudflare account ID" value={account} onInput={e => setAccount((e.target as HTMLInputElement).value)} inputStyle={{ fontFamily: 'ui-monospace, monospace' }} />}
      <ListInput type="password" placeholder={p.keyPlaceholder} value={key} onInput={e => setKey((e.target as HTMLInputElement).value)} autocomplete="off" />
    </List>
    {error && <BlockFooter><span role="alert">{error}</span></BlockFooter>}
    <Block className="grid grid-cols-2 grid-gap">
      <Button tonal round onClick={onDone}>Cancel</Button>
      <Button fill round onClick={() => void save()} disabled={act.busy || key.trim().length < 16 || (!!p.needsAccount && !account.trim())}>{act.busy ? 'Checking…' : 'Save'}</Button>
    </Block>
    <Block><Link external target="_blank" href={p.keyUrl}>Get a {p.name} key</Link></Block>
  </>;
}

/** Phone: keyword filters, a pushed page from Settings or Moderation. */
export function KeywordFiltersPage() {
  const { user } = useAtlasAuth();
  const q = useContentFilters();
  const ai = intelligenceReady(useIntelligence().data);
  const act = useFilterActions();
  const filters = q.data && 'filters' in q.data ? q.data.filters : [];
  const counts = useFilteredCounts(user?.id);
  const cautions = useFilterCautions(filters);
  const [text, setText] = useState(''), [options, setOptions] = useState<FilterOptions>(DEFAULT_OPTIONS), [duration, setDuration] = useState(0), [note, setNote] = useState<string | null>(null);
  const add = async (texts: string[], how: FilterOptions) => { if (texts.length) setNote(await act.add(texts, how)); };
  const file = useRef<HTMLInputElement>(null);
  const importText = async (v: string) => {
    const groups = parseImport(v);
    if (!groups.length) { setNote('Nothing to import there.'); return; }
    for (const g of groups) await add(g.texts, g.options);
  };
  const importList = () => f7.dialog.prompt('Paste your filters from Fedizen’s Safety settings, one per line, or a Mastodon filter export. If they come from Fedizen, remove them there: it matches words without context.', 'Import filters', v => void importText(v));
  const togglePlace = (p: FilterPlace) => {
    const next = options.places.includes(p) ? options.places.filter(x => x !== p) : [...options.places, p];
    if (next.length) setOptions(o => ({ ...o, places: FILTER_PLACES.filter(x => next.includes(x)) }));
  };
  return <Page>
    <Navbar title="Keyword filters" backLink backLinkShowText={false} />
    <input ref={file} type="file" accept="application/json,.json,text/plain,.txt,.csv" hidden
      onChange={async e => { const f = e.target.files?.[0]; e.target.value = ''; if (f && f.size < 2_000_000) await importText(await f.text()); }} />
    {!user ? <Block strong inset>Sign in to Atlas to keep keyword filters.</Block>
      : q.data && 'error' in q.data ? <Block strong inset>{AI_PROBLEM[q.data.error]}</Block>
      : <>
        <List strong inset>
          <ListInput type="text" placeholder="A word, phrase, #hashtag or topic" value={text} maxlength={200} onInput={e => setText((e.target as HTMLInputElement).value)} clearButton />
          <ListInput type="select" value={options.action} onChange={e => setOptions(o => ({ ...o, action: (e.target as HTMLSelectElement).value as FilterAction }))}>
            {(['hide', 'warn', 'blur'] as const).map(a => <option key={a} value={a}>{ACTION_LABEL[a]}</option>)}
          </ListInput>
          <ListInput type="select" value={duration} onChange={e => setDuration(Number((e.target as HTMLSelectElement).value))}>
            {DURATIONS.map((d, i) => <option key={d.label} value={i}>{d.label}</option>)}
          </ListInput>
        </List>
        <List strong inset dividers>
          {FILTER_PLACES.map(p => <ListItem key={p} checkbox title={PLACE_LABEL[p]} checked={options.places.includes(p)} onChange={() => togglePlace(p)} />)}
          <ListItem title="Not from people I follow"><Toggle slot="after" checked={options.exceptFollowing} onToggleChange={() => setOptions(o => ({ ...o, exceptFollowing: !o.exceptFollowing }))} /></ListItem>
        </List>
        <Block><Button fill round disabled={!text.trim()} onClick={async () => { await add([text], { ...options, expiresAt: expiresAfter(DURATIONS[duration].ms) }); setText(''); }}>Add</Button></Block>
        <BlockFooter>Add * to catch longer words too: spam* also hides spammer. A #hashtag matches only the hashtag.{ai ? ' Describe a topic in a few words to filter it whatever words a post uses.' : ''}</BlockFooter>
        {note && <BlockFooter><span role="alert">{note}</span></BlockFooter>}

        {!q.isLoading && filters.length > 0 && <BlockFooter>{totalLabel(filters, counts)}</BlockFooter>}
        {q.isLoading ? <Block strong inset>Loading…</Block> : <List strong inset dividers>
          {filters.map(f => <ListItem key={f.id} link="#" title={f.text} after={ACTION_SHORT[f.action]} onClick={() => pushPage(`/keyword-filters/${f.id}/`)}
            footer={[
              countLabel(counts.get(f.id)),
              filterSummary(f),
              ai && f.semantic && f.expansions.length ? `Also catches ${f.expansions.slice(0, 5).join(', ')}${f.expansions.length > 5 ? '…' : ''}` : '',
              !ai && f.kind === 'topic' ? 'A topic matches posts only with Intelligence on.' : '',
              ...(cautions.get(f.id) ?? []),
            ].filter(Boolean).join(' · ') || undefined} />)}
          {!filters.length && <ListItem title="No keyword filters yet." />}
        </List>}

        <List strong inset dividers>
          {ai && <ListItem link="#" title="Suggestions" footer="Filters to add or change, and accounts to look at" onClick={() => pushPage('/moderation-suggestions/')} />}
          <ListItem link="#" title="Paste a list" footer="From Fedizen’s Safety settings, one per line" onClick={importList} />
          <ListItem link="#" title="Import a file" footer="Mastodon’s filter export, or a text list" onClick={() => file.current?.click()} />
          {filters.length > 0 && <ListItem link="#" title="Export" footer="In Mastodon’s format" onClick={() => downloadExport(filters)} />}
          <ListItem link={FEDIZEN_KEYWORD_FILTERS_URL} external target="_blank" title="Fedizen’s Safety settings" />
          {!ai && <ListItem link="#" title="Check filters in context" footer="With Intelligence" onClick={() => pushPage('/intelligence/')} />}
        </List>

      </>}
  </Page>;
}

/**
 * Phone: one keyword filter (Settings → Moderation → Keyword filters → the filter), with everything desktop's editor
 * has: what it does, where, how long, not from people you follow, checking in context, the wordings it also catches
 * (remove, add, ask the AI again), what it caught, and Remove.
 */
export function KeywordFilterPage({ f7route, f7router }: { f7route?: { params: { id?: string } }; f7router?: { back: () => void } }) {
  const { user } = useAtlasAuth();
  const q = useContentFilters();
  const ai = intelligenceReady(useIntelligence().data);
  const act = useFilterActions();
  const filters = q.data && 'filters' in q.data ? q.data.filters : [];
  const f = filters.find(x => x.id === f7route?.params.id);
  const counts = useFilteredCounts(user?.id);
  const cautions = useFilterCautions(filters);
  const [busy, setBusy] = useState(false), [note, setNote] = useState<string | null>(null), [draft, setDraft] = useState('');
  const [words, setWords] = useState<string | null>(null);
  const run = async (work: () => Promise<unknown>) => { setBusy(true); setNote(null); try { const r = await work(); if (typeof r === 'string') setNote(r); } finally { setBusy(false); } };
  if (!f) return <Page><Navbar title="Keyword filter" backLink backLinkShowText={false} />
    <Block strong inset>{q.isLoading ? 'Loading…' : 'This filter was removed.'}</Block></Page>;
  const update = (patch: Parameters<Actions['update']>[1]) => run(() => act.update(f.id, patch));
  const togglePlace = (p: FilterPlace) => {
    const next = f.places.includes(p) ? f.places.filter(x => x !== p) : [...f.places, p];
    if (next.length) void update({ places: FILTER_PLACES.filter(x => next.includes(x)) });
  };
  const until = f.expiresAt ? (Date.parse(f.expiresAt) <= Date.now() ? 'Expired' : `Until ${new Date(f.expiresAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`) : null;
  const addWording = () => { const w = draft.trim(); if (!w || f.expansions.includes(w)) return; void update({ expansions: [...f.expansions, w] }); setDraft(''); };
  return <Page>
    <Navbar title={f.text} backLink backLinkShowText={false} />
    <BlockFooter>{countLabel(counts.get(f.id))}</BlockFooter>
    {[...(cautions.get(f.id) ?? []), ...(!ai && f.kind === 'topic' ? ['A topic matches posts only through its wordings, which come with Intelligence.'] : [])].map(c => <BlockFooter key={c}><span className="atlas-filter-caution">{c}</span></BlockFooter>)}

    <BlockTitle>Words</BlockTitle>
    <List strong inset>
      <ListInput type="text" placeholder="A word, phrase, #hashtag or topic" value={words ?? f.text} maxlength={200} disabled={busy}
        onInput={e => setWords((e.target as HTMLInputElement).value)} clearButton />
    </List>
    {words !== null && words.trim() && words.trim() !== f.text && <Block>
      <Button fill round disabled={busy} onClick={() => void run(async () => { const why = await act.update(f.id, { text: words }); if (!why) setWords(null); return why; })}>Save</Button>
    </Block>}
    <BlockFooter>Changing the words starts its other wordings again.</BlockFooter>

    <BlockTitle>What it does</BlockTitle>
    <List strong inset dividers>
      {(['hide', 'warn', 'blur'] as const).map(a => <ListItem key={a} title={ACTION_LABEL[a]} radio radioIcon="end" name="filter-action" checked={f.action === a} disabled={busy} onChange={() => void update({ action: a })} />)}
    </List>

    <BlockTitle>Where</BlockTitle>
    <List strong inset dividers>
      {FILTER_PLACES.map(p => <ListItem key={p} checkbox title={PLACE_LABEL[p]} checked={f.places.includes(p)} disabled={busy || (f.places.length === 1 && f.places.includes(p))} onChange={() => togglePlace(p)} />)}
      <ListItem title="Not from people I follow" footer="Their posts always show."><Toggle slot="after" checked={f.exceptFollowing} disabled={busy} onToggleChange={() => void update({ exceptFollowing: !f.exceptFollowing })} /></ListItem>
    </List>

    <BlockTitle>For</BlockTitle>
    <List strong inset>
      <ListInput type="select" value={until ? -1 : 0} disabled={busy} onChange={e => { const i = Number((e.target as HTMLSelectElement).value); if (i >= 0) void update({ expiresAt: expiresAfter(DURATIONS[i].ms) }); }}>
        {until && <option value={-1}>{until}</option>}
        {DURATIONS.map((d, i) => <option key={d.label} value={i}>{d.label}</option>)}
      </ListInput>
    </List>

    {ai && <List strong inset dividers>
      <ListItem title="Check in context" footer="Your AI model reads posts that match, so a word used another way isn’t caught."><Toggle slot="after" checked={f.semantic} disabled={busy} onToggleChange={() => void update({ semantic: !f.semantic })} /></ListItem>
    </List>}

    {(ai || f.expansions.length > 0) && <>
      <BlockTitle>Also catches</BlockTitle>
      <List strong inset dividers>
        {f.expansions.map(w => <ListItem key={w} title={w}><Link slot="after" className={busy ? 'disabled' : undefined} onClick={() => void update({ expansions: f.expansions.filter(x => x !== w) })} aria-label={`Stop catching “${w}”`}>Remove</Link></ListItem>)}
        {!f.expansions.length && <ListItem title="Nothing else yet." />}
        <ListInput type="text" placeholder="Another word, phrase or #hashtag" value={draft} maxlength={60} disabled={busy || f.expansions.length >= MAX_EXPANSIONS}
          onInput={e => setDraft((e.target as HTMLInputElement).value)} clearButton />
      </List>
      <Block>
        <Button tonal round disabled={busy || !draft.trim()} onClick={addWording}>Add wording</Button>
        {ai && <Button round disabled={busy} style={{ marginTop: 8 }} onClick={() => void run(() => act.widen(f.id))}>Ask the AI for wordings again</Button>}
      </Block>
    </>}

    {note && <BlockFooter><span role="alert">{note}</span></BlockFooter>}
    <List strong inset>
      <ListItem link="#" title="Remove filter" className="atlas-destructive" onClick={() => f7.dialog.confirm(`Stop filtering “${f.text}”?`, 'Remove filter', async () => { await act.remove(f.id); f7router?.back(); })} />
    </List>
  </Page>;
}

type Actions = ReturnType<typeof useFilterActions>;
