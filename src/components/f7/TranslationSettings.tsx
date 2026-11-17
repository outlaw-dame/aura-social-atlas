import { useState } from 'react';
import { Block, BlockFooter, BlockTitle, Button, Link, List, ListInput, ListItem, Toggle, f7 } from 'framework7-react';
import { languageName, readingKey, TARGET_LANGUAGES } from '@/lib/translation/languages';
import { setTranslation } from '@/lib/translation/prefs';
import { DEEPL_KEY_URL, SERVICE_LABEL, usageText, useTranslationSettings } from '@/components/social/TranslationSettings';

/** Phone: Settings → Intelligence → Translation (the same settings as desktop's TranslationSettings). */
export function MobileTranslationSettings() {
  const t = useTranslationSettings();
  const { prefs } = t;
  const deepl = t.keys?.deepl ?? null;
  const [adding, setAdding] = useState(false), [key, setKey] = useState(''), [error, setError] = useState<string | null>(null);
  const off = !prefs.enabled;
  return <>
    <BlockTitle>Translation</BlockTitle>
    <List strong inset dividers>
      <ListItem title="Translate posts"><Toggle slot="after" checked={prefs.enabled} onToggleChange={() => setTranslation({ enabled: !prefs.enabled })} /></ListItem>
      <ListInput type="select" label="Translate into" value={prefs.target ?? ''} disabled={off} onChange={e => setTranslation({ target: (e.target as HTMLSelectElement).value || undefined })}>
        <option value="">{languageName(t.browserTarget)} (your phone’s language)</option>
        {TARGET_LANGUAGES.map(l => <option key={l} value={l}>{languageName(l)}</option>)}
      </ListInput>
      <ListItem title="Translate automatically" footer="As posts come into view, with Show original under them." disabled={off}><Toggle slot="after" checked={prefs.auto} disabled={off} onToggleChange={() => setTranslation({ auto: !prefs.auto })} /></ListItem>
      <ListItem title="Translate on this device" disabled={off} footer={t.device ? 'Nothing leaves the device. A language downloads once, the first time you tap Translate.' : 'This browser can’t translate on the device. Choose a service below.'}>
        <Toggle slot="after" checked={prefs.useDevice} disabled={off} onToggleChange={() => setTranslation({ useDevice: !prefs.useDevice })} />
      </ListItem>
    </List>
    <BlockFooter>Posts in languages you don’t read are translated where they are, keeping their links, mentions and formatting. Works without AI. These settings are kept on this device.</BlockFooter>

    <BlockTitle>Languages you read</BlockTitle>
    <List strong inset dividers>
      {t.read.map(l => <ListItem key={l} title={languageName(l)} link={l !== readingKey(t.target) ? '#' : undefined} after={l !== readingKey(t.target) ? 'Remove' : undefined}
        onClick={l !== readingKey(t.target) ? () => t.removeRead(l) : undefined} />)}
      <ListInput type="select" value="" disabled={off} onChange={e => { const v = (e.target as HTMLSelectElement).value; if (v) t.addRead(v); }}>
        <option value="">Add a language…</option>
        {TARGET_LANGUAGES.filter(l => !t.read.includes(l)).map(l => <option key={l} value={l}>{languageName(l)}</option>)}
      </ListInput>
    </List>
    <BlockFooter>Never offered for translation.</BlockFooter>

    <BlockTitle>Translation service</BlockTitle>
    <List strong inset dividers>
      {(['none', 'deepl', 'ai'] as const).map(c => <ListItem key={c} radio radioIcon="end" name="tr-cloud" title={SERVICE_LABEL[c]} checked={prefs.cloud === c}
        disabled={off || (c === 'deepl' ? !deepl : c === 'ai' ? !t.aiReady : false)} onChange={() => setTranslation({ cloud: c })}
        footer={c === 'none' ? 'On this device only.' : c === 'deepl' ? (deepl ? [`Key ${deepl.hint} · ${deepl.plan === 'free' ? 'API Free' : 'API Pro'}`, usageText(deepl)].filter(Boolean).join(' · ') : 'Add your DeepL key below.') : t.aiReady ? `${t.aiName}, with your Intelligence key.` : 'Turn on Intelligence with a key to use it.'} />)}
      <ListItem title="Translate automatically with the service too" footer="Otherwise the service only translates when you tap Translate." disabled={off || prefs.cloud === 'none' || !prefs.auto}>
        <Toggle slot="after" checked={prefs.autoCloud} disabled={off || prefs.cloud === 'none' || !prefs.auto} onToggleChange={() => setTranslation({ autoCloud: !prefs.autoCloud })} />
      </ListItem>
    </List>
    <BlockFooter>Used when this device can’t translate. Only public and unlisted posts are ever sent.</BlockFooter>

    <BlockTitle>DeepL key</BlockTitle>
    <List strong inset dividers>
      {deepl && <ListItem link="#" title="Remove DeepL key" footer={`Key ${deepl.hint}`} onClick={() => f7.dialog.confirm('Remove your DeepL key?', 'Remove key', () => void t.removeDeepl())} />}
      <ListItem link="#" title={deepl ? 'Replace key' : 'Add key'} footer="Your own API key, Free or Pro" onClick={() => setAdding(a => !a)} />
    </List>
    {adding && <>
      <List strong inset>
        <ListInput type="password" placeholder="DeepL authentication key" value={key} onInput={e => setKey((e.target as HTMLInputElement).value)} autocomplete="off" />
      </List>
      <BlockFooter>{t.keys && !t.keys.serverKeys ? 'This Atlas server isn’t set up to keep keys.' : 'Checked with DeepL, then kept encrypted on Atlas’s server and only ever sent to DeepL. DeepL’s API doesn’t accept requests from a browser, so it can’t stay on this phone.'}</BlockFooter>
      {error && <BlockFooter><span role="alert">{error}</span></BlockFooter>}
      <Block className="grid grid-cols-2 grid-gap">
        <Button tonal round onClick={() => setAdding(false)}>Cancel</Button>
        <Button fill round disabled={t.busy || key.trim().length < 16} onClick={async () => { setError(null); const err = await t.saveDeepl(key.trim()); if (err) setError(err); else { setKey(''); setAdding(false); } }}>{t.busy ? 'Checking…' : 'Save'}</Button>
      </Block>
      <Block><Link external target="_blank" href={DEEPL_KEY_URL}>Get a DeepL API key</Link></Block>
    </>}
  </>;
}
