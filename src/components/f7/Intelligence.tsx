import { useState } from 'react';
import { Block, BlockFooter, BlockTitle, Button, Link, List, ListInput, ListItem, Navbar, Page, Toggle, f7 } from 'framework7-react';
import { PROVIDERS, PROVIDER_IDS, type ProviderId } from '@/lib/intelligence/providers';
import { parseFilterList, type ContentFilter, type FilterAction } from '@/lib/content-filter';
import { FEDIZEN_KEYWORD_FILTERS_URL } from '@/lib/fedizen-feed';
import { AI_PROBLEM, intelligenceReady, useContentFilters, useFilterActions, useFilterCautions, useIntelligence, useIntelligenceActions } from '@/components/social/useIntelligence';
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
  const active = s?.keys.find(k => k.provider === s.provider);
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

        <BlockTitle>Providers</BlockTitle>
        <List strong inset dividers>
          {PROVIDER_IDS.map(id => {
            const p = PROVIDERS[id], key = s.keys.find(k => k.provider === id);
            return key
              ? <ListItem key={id} radio radioIcon="end" name="ai-provider" title={p.product} footer={`${p.name} · key ${key.hint}`} checked={s.provider === id} onChange={() => void act.update({ provider: id })} />
              : <ListItem key={id} link="#" title={p.product} footer={p.name} after="Add key" onClick={() => setAdding(id)} />;
          })}
        </List>
        <BlockFooter>Keys are encrypted on Atlas’s server, never shown again, and only ever sent to their own provider.</BlockFooter>
        {s.keys.length > 0 && <List strong inset dividers>
          {s.keys.map(k => <ListItem key={k.provider} link="#" title={`${PROVIDERS[k.provider].product} key`} onClick={() => f7.actions.create({ buttons: [[
            { text: 'Replace key', onClick: () => setAdding(k.provider) },
            { text: 'Remove key', color: 'red', onClick: () => void act.removeKey(k.provider) },
          ], [{ text: 'Cancel', strong: true }]] }).open()} />)}
        </List>}
        {adding && <KeyForm provider={adding} onDone={() => setAdding(null)} />}

        {active && <>
          <BlockTitle>Model</BlockTitle>
          <List strong inset>
            <ListInput type="select" value={s.model ?? ''} onChange={e => void act.update({ model: (e.target as HTMLSelectElement).value })}>
              {active.models.map(m => <option key={m} value={m}>{m}</option>)}
            </ListInput>
          </List>
        </>}

        <BlockTitle>Features</BlockTitle>
        <List strong inset dividers>
          <ListItem title="Assistant" footer="A sparkle button opens chat."><Toggle slot="after" checked={social.assistantEnabled && ready} disabled={!ready} onToggleChange={() => social.setAssistantEnabled(!social.assistantEnabled)} /></ListItem>
          <ListItem title="Check every post against topic filters" footer="Also sends every public post you scroll past to your provider."><Toggle slot="after" checked={s.deepMatching} disabled={!ready || act.busy} onToggleChange={() => void act.update({ deepMatching: !s.deepMatching })} /></ListItem>
          <ListItem link="#" title="Keyword filters" onClick={() => pushPage('/keyword-filters/')} />
        </List>
      </>}
  </Page>;
}

function KeyForm({ provider, onDone }: { provider: ProviderId; onDone: () => void }) {
  const act = useIntelligenceActions();
  const p = PROVIDERS[provider];
  const [key, setKey] = useState(''), [account, setAccount] = useState(''), [error, setError] = useState<string | null>(null);
  const save = async () => {
    setError(null);
    const err = await act.saveKey(provider, key.trim(), p.needsAccount ? account.trim() : undefined);
    if (err) { setError(err); return; }
    setKey(''); onDone();
  };
  return <>
    <BlockTitle>{p.product} key</BlockTitle>
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
  const [text, setText] = useState(''), [action, setAction] = useState<FilterAction>('hide'), [note, setNote] = useState<string | null>(null);
  const [suggested, setSuggested] = useState<{ text: string; reason: string }[] | null>(null), [thinking, setThinking] = useState(false);
  const add = async (texts: string[]) => { if (texts.length) setNote(await act.add(texts, action)); };
  const importList = () => f7.dialog.prompt('Paste your filters from Fedizen’s Safety settings, one per line. Then remove them on Fedizen, which matches words without context.', 'Import from Fedizen', v => void add(parseFilterList(v)));
  const edit = (f: ContentFilter) => f7.actions.create({ buttons: [[
    { text: f.action === 'hide' ? 'Hide behind a warning instead' : 'Hide completely instead', onClick: () => void act.update(f.id, { action: f.action === 'hide' ? 'warn' : 'hide' }) },
    ...(ai ? [{ text: f.semantic ? 'Match words only' : 'Check in context', onClick: () => void act.update(f.id, { semantic: !f.semantic }) }] : []),
    { text: 'Remove', color: 'red', onClick: () => void act.remove(f.id) },
  ], [{ text: 'Cancel', strong: true }]] }).open();
  return <Page>
    <Navbar title="Keyword filters" backLink backLinkShowText={false} />
    {!user ? <Block strong inset>Sign in to Atlas to keep keyword filters.</Block>
      : q.data && 'error' in q.data ? <Block strong inset>{AI_PROBLEM[q.data.error]}</Block>
      : <>
        <List strong inset>
          <ListInput type="text" placeholder="A word, phrase, #hashtag or topic" value={text} maxlength={200} onInput={e => setText((e.target as HTMLInputElement).value)} clearButton />
          <ListInput type="select" value={action} onChange={e => setAction((e.target as HTMLSelectElement).value as FilterAction)}>
            <option value="hide">Hide</option>
            <option value="warn">Hide behind a warning</option>
          </ListInput>
        </List>
        <Block><Button fill round disabled={!text.trim()} onClick={async () => { await add([text]); setText(''); }}>Add</Button></Block>
        <BlockFooter>Add * to catch longer words too: spam* also hides spammer.{ai ? ' Describe a topic in a few words to filter it whatever words a post uses.' : ''}</BlockFooter>
        {note && <BlockFooter><span role="alert">{note}</span></BlockFooter>}

        {q.isLoading ? <Block strong inset>Loading…</Block> : <List strong inset dividers>
          {filters.map(f => <ListItem key={f.id} link="#" title={f.text} after={f.action === 'warn' ? 'Warn' : 'Hide'} onClick={() => edit(f)}
            footer={[
              ai && f.semantic && f.expansions.length ? `Also catches ${f.expansions.slice(0, 5).join(', ')}${f.expansions.length > 5 ? '…' : ''}` : '',
              !ai && f.kind === 'topic' ? 'A topic matches posts only with Intelligence on.' : '',
              ...(cautions.get(f.id) ?? []),
            ].filter(Boolean).join(' ') || undefined} />)}
          {!filters.length && <ListItem title="No keyword filters yet." />}
        </List>}

        <List strong inset dividers>
          {ai && filters.length > 0 && <ListItem link="#" title={thinking ? 'Thinking…' : 'Suggest filters'} onClick={async () => {
            setThinking(true); const r = await act.suggest(); setThinking(false);
            if ('error' in r) setNote(AI_PROBLEM[r.error]); else setSuggested(r.suggestions);
          }} />}
          <ListItem link="#" title="Import from Fedizen" onClick={importList} />
          <ListItem link={FEDIZEN_KEYWORD_FILTERS_URL} external target="_blank" title="Fedizen’s Safety settings" />
          {!ai && <ListItem link="#" title="Check filters in context" footer="With Intelligence" onClick={() => pushPage('/intelligence/')} />}
        </List>

        {suggested && <>
          <BlockTitle>Suggested</BlockTitle>
          <List strong inset dividers>
            {suggested.map(s => { const have = filters.some(f => f.text.toLowerCase() === s.text.toLowerCase());
              return <ListItem key={s.text} title={s.text} footer={s.reason}>
                <Link slot="after" onClick={() => void add([s.text])} className={have ? 'disabled' : ''}>{have ? 'Added' : 'Add'}</Link>
              </ListItem>; })}
            {!suggested.length && <ListItem title="Your filters already cover their topics well." />}
          </List>
        </>}
      </>}
  </Page>;
}
