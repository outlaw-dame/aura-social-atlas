import { useState } from 'react';
import { Block, BlockFooter, BlockTitle, Button, Link, List, ListInput, ListItem, Navbar, Page, Toggle, f7 } from 'framework7-react';
import { PROVIDERS, PROVIDER_IDS, type ProviderId } from '@/lib/intelligence/providers';
import { BROWSER_CAPABLE } from '@/lib/intelligence/llm';
import { FILTER_PLACES, type ContentFilter, type FilterAction, type FilterPlace } from '@/lib/content-filter';
import { FEDIZEN_KEYWORD_FILTERS_URL } from '@/lib/fedizen-feed';
import { AI_PROBLEM, DEFAULT_OPTIONS, intelligenceReady, useContentFilters, useFilterActions, useFilterCautions, useIntelligence, useIntelligenceActions, type FilterOptions } from '@/components/social/useIntelligence';
import { ACTION_LABEL, ACTION_SHORT, DURATIONS, PLACE_LABEL, downloadExport, expiresAfter, filterSummary, parseImport } from '@/components/social/filter-options';
import { DEVICE_KEY_NOTE } from '@/components/social/IntelligenceSettings';
import { useAtlasAuth } from '@/components/social/AuthState';
import { useSocial } from '@/components/social/SocialState';
import { pushPage } from './navigation';

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
  const models = active && s ? (active.where === 'device' ? s.deviceKeys : s.keys).find(k => k.provider === active.provider)?.models ?? [] : [];
  const saved = s ? [...s.keys.map(k => ({ ...k, where: 'server' as const })), ...s.deviceKeys.map(k => ({ ...k, where: 'device' as const }))] : [];
  return <Page>
    <Navbar title="Intelligence" backLink backLinkShowText={false} />
    {!user ? <Block strong inset>Sign in to Atlas to use Intelligence.</Block>
      : q.isLoading ? <Block strong inset>Loading…</Block>
      : !s?.available ? <Block strong inset>Intelligence isn’t set up on this Atlas server yet.</Block>
      : <>
        <List strong inset dividers>
          <ListItem title="Use AI in Atlas"><Toggle slot="after" checked={s.enabled} disabled={act.busy} onToggleChange={() => void act.update({ enabled: !s.enabled })} /></ListItem>
        </List>
        <BlockFooter>Atlas works fully without AI. With your own key, a provider only receives what a feature needs: posts your filters are checking, your filter list when you ask for suggestions, and what you type to the assistant. Direct messages are never sent.</BlockFooter>

        {saved.length > 0 && <>
          <BlockTitle>Your keys</BlockTitle>
          <List strong inset dividers>
            {saved.map(k => <ListItem key={`${k.provider}-${k.where}`} radio radioIcon="end" name="ai-key" title={PROVIDERS[k.provider].product}
              footer={`${k.where === 'device' ? 'On this device' : 'On Atlas’s server'} · key ${k.hint}`} checked={active?.provider === k.provider && active.where === k.where}
              onChange={() => void act.choose(k.provider, k.where)} />)}
          </List>
          <List strong inset dividers>
            {saved.map(k => <ListItem key={`rm-${k.provider}-${k.where}`} link="#" title={`Remove ${PROVIDERS[k.provider].product} key`} footer={k.where === 'device' ? 'On this device' : 'On Atlas’s server'}
              onClick={() => f7.dialog.confirm(`Remove this ${PROVIDERS[k.provider].product} key?`, 'Remove key', () => void act.removeKey(k.provider, k.where))} />)}
          </List>
        </>}

        <BlockTitle>Add a key</BlockTitle>
        <List strong inset dividers>
          {PROVIDER_IDS.map(id => <ListItem key={id} link="#" title={PROVIDERS[id].product} footer={PROVIDERS[id].name} onClick={() => setAdding(id)} />)}
        </List>
        {adding && <KeyForm provider={adding} serverKeys={s.serverKeys} onDone={() => setAdding(null)} />}

        {active && <>
          <BlockTitle>Model</BlockTitle>
          <List strong inset>
            <ListInput type="select" value={active.model} onChange={e => void act.choose(active.provider, active.where, (e.target as HTMLSelectElement).value)}>
              {models.map(m => <option key={m} value={m}>{m}</option>)}
            </ListInput>
          </List>
        </>}

        <BlockTitle>Features</BlockTitle>
        <List strong inset dividers>
          <ListItem title="Assistant" footer={active?.where === 'device' ? 'Needs a key on Atlas’s server.' : 'A sparkle button opens chat.'}>
            <Toggle slot="after" checked={social.assistantEnabled && ready && active?.where === 'server'} disabled={!ready || active?.where !== 'server'} onToggleChange={() => social.setAssistantEnabled(!social.assistantEnabled)} />
          </ListItem>
          <ListItem title="Check every post against topic filters" footer="Also sends every public post you scroll past to your provider."><Toggle slot="after" checked={s.deepMatching} disabled={!ready || act.busy} onToggleChange={() => void act.update({ deepMatching: !s.deepMatching })} /></ListItem>
          <ListItem link="#" title="Keyword filters" onClick={() => pushPage('/keyword-filters/')} />
        </List>
      </>}
  </Page>;
}

function KeyForm({ provider, serverKeys, onDone }: { provider: ProviderId; serverKeys: boolean; onDone: () => void }) {
  const act = useIntelligenceActions();
  const p = PROVIDERS[provider];
  const canDevice = BROWSER_CAPABLE[provider];
  const [where, setWhere] = useState<'server' | 'device'>(serverKeys ? 'server' : 'device');
  const [key, setKey] = useState(''), [account, setAccount] = useState(''), [error, setError] = useState<string | null>(null);
  const save = async () => {
    setError(null);
    const err = await act.saveKey(provider, key.trim(), p.needsAccount ? account.trim() : undefined, where);
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
  const cautions = useFilterCautions(filters);
  const [text, setText] = useState(''), [options, setOptions] = useState<FilterOptions>(DEFAULT_OPTIONS), [duration, setDuration] = useState(0), [note, setNote] = useState<string | null>(null);
  const [suggested, setSuggested] = useState<{ text: string; reason: string }[] | null>(null), [thinking, setThinking] = useState(false);
  const add = async (texts: string[], how: FilterOptions) => { if (texts.length) setNote(await act.add(texts, how)); };
  const importList = () => f7.dialog.prompt('Paste your filters from Fedizen’s Safety settings, one per line, or a Mastodon filter export. If they come from Fedizen, remove them there: it matches words without context.', 'Import filters', async v => {
    const groups = parseImport(v);
    if (!groups.length) { setNote('Nothing to import there.'); return; }
    for (const g of groups) await add(g.texts, g.options);
  });
  const togglePlace = (p: FilterPlace) => {
    const next = options.places.includes(p) ? options.places.filter(x => x !== p) : [...options.places, p];
    if (next.length) setOptions(o => ({ ...o, places: FILTER_PLACES.filter(x => next.includes(x)) }));
  };
  return <Page>
    <Navbar title="Keyword filters" backLink backLinkShowText={false} />
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

        {q.isLoading ? <Block strong inset>Loading…</Block> : <List strong inset dividers>
          {filters.map(f => <ListItem key={f.id} link="#" title={f.text} after={ACTION_SHORT[f.action]} onClick={() => pushFilter(f, ai, act, setNote)}
            footer={[
              filterSummary(f),
              ai && f.semantic && f.expansions.length ? `Also catches ${f.expansions.slice(0, 5).join(', ')}${f.expansions.length > 5 ? '…' : ''}` : '',
              !ai && f.kind === 'topic' ? 'A topic matches posts only with Intelligence on.' : '',
              ...(cautions.get(f.id) ?? []),
            ].filter(Boolean).join(' · ') || undefined} />)}
          {!filters.length && <ListItem title="No keyword filters yet." />}
        </List>}

        <List strong inset dividers>
          {ai && filters.length > 0 && <ListItem link="#" title={thinking ? 'Thinking…' : 'Suggest filters'} onClick={async () => {
            setThinking(true); const r = await act.suggest(); setThinking(false);
            if ('error' in r) setNote(AI_PROBLEM[r.error]); else setSuggested(r.suggestions);
          }} />}
          <ListItem link="#" title="Import" footer="Fedizen’s list or a Mastodon export" onClick={importList} />
          {filters.length > 0 && <ListItem link="#" title="Export" footer="In Mastodon’s format" onClick={() => downloadExport(filters)} />}
          <ListItem link={FEDIZEN_KEYWORD_FILTERS_URL} external target="_blank" title="Fedizen’s Safety settings" />
          {!ai && <ListItem link="#" title="Check filters in context" footer="With Intelligence" onClick={() => pushPage('/intelligence/')} />}
        </List>

        {suggested && <>
          <BlockTitle>Suggested</BlockTitle>
          <List strong inset dividers>
            {suggested.map(s => { const have = filters.some(f => f.text.toLowerCase() === s.text.toLowerCase());
              return <ListItem key={s.text} title={s.text} footer={s.reason}>
                <Link slot="after" onClick={() => void add([s.text], DEFAULT_OPTIONS)} className={have ? 'disabled' : ''}>{have ? 'Added' : 'Add'}</Link>
              </ListItem>; })}
            {!suggested.length && <ListItem title="Your filters already cover their topics well." />}
          </List>
        </>}
      </>}
  </Page>;
}

type Actions = ReturnType<typeof useFilterActions>;

/** A filter's choices, as an action sheet (Apple HIG: a short list of actions on one item). */
function pushFilter(f: ContentFilter, ai: boolean, act: Actions, setNote: (n: string | null) => void) {
  const editWordings = () => f7.dialog.prompt('Separate them with commas. Remove any you don’t want caught.', `“${f.text}” also catches`, v => {
    void act.update(f.id, { expansions: v.split(',').map(x => x.trim()).filter(Boolean) });
  }, () => {}, f.expansions.join(', '));
  f7.actions.create({ buttons: [[
    { text: f.text, label: true },
    ...(['hide', 'warn', 'blur'] as const).filter(a => a !== f.action).map(a => ({ text: ACTION_LABEL[a], onClick: () => void act.update(f.id, { action: a }) })),
    ...DURATIONS.map(d => ({ text: d.ms === null ? 'Keep forever' : `Keep for ${d.label}`, onClick: () => void act.update(f.id, { expiresAt: expiresAfter(d.ms) }) })),
    { text: f.exceptFollowing ? 'Include people I follow' : 'Not from people I follow', onClick: () => void act.update(f.id, { exceptFollowing: !f.exceptFollowing }) },
    ...(ai ? [{ text: f.semantic ? 'Match words only' : 'Check in context', onClick: () => void act.update(f.id, { semantic: !f.semantic }) }] : []),
    ...(ai || f.expansions.length ? [{ text: 'Edit what it also catches', onClick: editWordings }] : []),
    ...(ai ? [{ text: 'Ask the AI for wordings again', onClick: async () => setNote(await act.widen(f.id)) }] : []),
    { text: 'Remove', color: 'red', onClick: () => void act.remove(f.id) },
  ], [{ text: 'Cancel', strong: true }]] }).open();
}
