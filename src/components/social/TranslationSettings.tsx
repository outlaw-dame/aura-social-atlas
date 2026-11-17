import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { ArrowUpRight, KeyRound, Languages, Trash2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { getTranslationKeys, removeDeeplKey, saveDeeplKey, type TranslateProblem } from '@/lib/translation.functions';
import { browserLanguages, languageName, readingKey, TARGET_LANGUAGES } from '@/lib/translation/languages';
import { readOf, setTranslation, targetOf, useTranslationPrefs, type CloudEngine } from '@/lib/translation/prefs';
import { canTranslateOnDevice } from '@/lib/translation/on-device';
import { PROVIDERS } from '@/lib/intelligence/providers';
import { useAtlasAuth } from './AuthState';
import { intelligenceReady, useIntelligence } from './useIntelligence';

/** Where to make a DeepL API key (DeepL's API plans page: Free and Pro). */
export const DEEPL_KEY_URL = 'https://www.deepl.com/pro-api';
export const DEEPL_PROBLEM: Record<TranslateProblem, string> = {
  'bad-key': 'DeepL didn’t accept that key.', quota: 'This key’s allowance for the period is used up.', 'rate-limited': 'DeepL is busy. Try again in a moment.',
  'too-long': 'Too long for DeepL.', unsupported: 'DeepL can’t translate that.', unavailable: 'DeepL couldn’t be reached. Try again.',
  'not-configured': 'This Atlas server isn’t set up to keep keys.', 'no-key': 'There’s no DeepL key yet.', storage: 'The key couldn’t be saved. Try again.',
};

/** The translation settings and the DeepL key, shared by desktop and the phone. */
export function useTranslationSettings() {
  const prefs = useTranslationPrefs();
  const { user } = useAtlasAuth();
  const qc = useQueryClient();
  const keysFn = useServerFn(getTranslationKeys), saveFn = useServerFn(saveDeeplKey), removeFn = useServerFn(removeDeeplKey);
  const keys = useQuery({ queryKey: ['translation-keys', user?.id], queryFn: () => keysFn(), enabled: !!user, staleTime: 60_000 });
  const ai = useIntelligence().data;
  const [busy, setBusy] = useState(false);
  const browser = browserLanguages();
  const read = readOf(prefs, browser);
  return {
    prefs, user, busy, keys: keys.data, keysLoading: keys.isLoading,
    device: canTranslateOnDevice(),
    aiReady: intelligenceReady(ai), aiName: ai?.active ? PROVIDERS[ai.active.provider].product : null,
    target: targetOf(prefs, browser), browserTarget: targetOf({ ...prefs, target: undefined }, browser), read,
    addRead: (l: string) => setTranslation({ read: [...new Set([...read, readingKey(l)])] }),
    removeRead: (l: string) => setTranslation({ read: read.filter(x => x !== l) }),
    saveDeepl: async (key: string): Promise<string | null> => {
      if (!user) return 'Sign in to Atlas first.';
      setBusy(true);
      try {
        const r = await saveFn({ data: { expectedAtlasUserId: user.id, key } }).catch(() => ({ error: 'unavailable' as const }));
        if ('error' in r) return DEEPL_PROBLEM[r.error];
        setTranslation({ cloud: 'deepl' });
        await qc.invalidateQueries({ queryKey: ['translation-keys'] });
        return null;
      } finally { setBusy(false); }
    },
    removeDeepl: async () => {
      if (!user) return;
      setBusy(true);
      try {
        await removeFn({ data: { expectedAtlasUserId: user.id } }).catch(() => null);
        if (prefs.cloud === 'deepl') setTranslation({ cloud: 'none' });
        await qc.invalidateQueries({ queryKey: ['translation-keys'] });
      } finally { setBusy(false); }
    },
  };
}

export const SERVICE_LABEL: Record<CloudEngine, string> = { none: 'None', deepl: 'DeepL', ai: 'Your AI provider' };
export const usageText = (d: { used?: number; limit?: number }) =>
  d.limit ? `${(d.used ?? 0).toLocaleString()} of ${d.limit.toLocaleString()} characters used this period` : null;

/** Desktop: Settings → Intelligence → Translation. */
export function TranslationSettings() {
  const t = useTranslationSettings();
  const { prefs } = t;
  const [key, setKey] = useState(''), [error, setError] = useState<string | null>(null), [adding, setAdding] = useState(false);
  const off = !prefs.enabled;
  const deepl = t.keys?.deepl ?? null;
  return <section className="border-b border-border py-6" aria-labelledby="tr-title">
    <div className="flex items-start justify-between gap-6">
      <div><h2 id="tr-title" className="flex items-center gap-2 text-base font-semibold"><Languages className="size-4" aria-hidden="true" />Translation</h2>
        <p id="tr-detail" className="mt-1 text-sm leading-relaxed text-muted-foreground">Posts in languages you don’t read can be translated where they are, keeping their links, mentions and formatting. Works without AI.</p></div>
      <Switch aria-label="Translate posts" aria-describedby="tr-detail" checked={prefs.enabled} onCheckedChange={v => setTranslation({ enabled: v })} />
    </div>

    <fieldset disabled={off} className="mt-5 space-y-5 disabled:opacity-50">
      <label className="flex flex-wrap items-center gap-3 text-sm">
        <span className="font-semibold">Translate into</span>
        <select className="h-9 min-w-0 flex-1 rounded-md border border-input bg-background px-3 text-sm" value={prefs.target ?? ''} onChange={e => setTranslation({ target: e.target.value || undefined })}>
          <option value="">{languageName(t.browserTarget)} (your browser’s language)</option>
          {TARGET_LANGUAGES.map(l => <option key={l} value={l}>{languageName(l)}</option>)}
        </select>
      </label>

      <div>
        <p className="text-sm font-semibold">Languages you read</p>
        <p className="mt-1 text-sm text-muted-foreground">Never offered for translation.</p>
        <ul className="mt-2 flex flex-wrap gap-2" aria-label="Languages you read">
          {t.read.map(l => <li key={l} className="inline-flex items-center gap-1 rounded-full border border-border py-1 pl-3 pr-1 text-sm">{languageName(l)}
            {l !== readingKey(t.target) && <button type="button" className="grid size-6 place-items-center rounded-full hover:bg-muted" aria-label={`Remove ${languageName(l)}`} onClick={() => t.removeRead(l)}><X className="size-3.5" /></button>}
          </li>)}
          <li><select aria-label="Add a language you read" className="h-8 rounded-full border border-input bg-background px-3 text-sm" value="" onChange={e => { if (e.target.value) t.addRead(e.target.value); }}>
            <option value="">Add…</option>
            {TARGET_LANGUAGES.filter(l => !t.read.includes(l)).map(l => <option key={l} value={l}>{languageName(l)}</option>)}
          </select></li>
        </ul>
      </div>

      <Toggle title="Translate automatically" detail="Posts in other languages are translated as they come into view, with Show original under them." checked={prefs.auto} onChange={v => setTranslation({ auto: v })} id="tr-auto" />

      <Toggle title="Translate on this device" id="tr-device" checked={prefs.useDevice} onChange={v => setTranslation({ useDevice: v })}
        detail={t.device ? 'This browser translates on the device: nothing leaves it. A language is downloaded once, the first time you tap Translate for it.'
          : 'This browser can’t translate on the device (Chrome and Edge on a computer can). Choose a service below to translate here.'} />

      <div>
        <p className="text-sm font-semibold">Translation service</p>
        <p className="mt-1 text-sm text-muted-foreground">Used when this device can’t translate. Only public and unlisted posts are ever sent; others are translated on the device or not at all.</p>
        <div className="mt-3 space-y-2 text-sm" role="radiogroup" aria-label="Translation service">
          {(['none', 'deepl', 'ai'] as const).map(c => {
            const disabled = c === 'deepl' ? !deepl : c === 'ai' ? !t.aiReady : false;
            const note = c === 'none' ? 'Translate on this device only.'
              : c === 'deepl' ? (deepl ? `Your DeepL ${deepl.plan === 'free' ? 'API Free' : 'API Pro'} key ${deepl.hint}${usageText(deepl) ? ` · ${usageText(deepl)}` : ''}` : 'Add your DeepL key below.')
              : t.aiReady ? `${t.aiName}, with your Intelligence key. Slower than DeepL; counts toward your provider’s usage.` : 'Turn on Intelligence with a key to use it.';
            return <label key={c} className="flex items-start gap-2">
              <input type="radio" name="tr-cloud" className="mt-1 accent-[var(--accent)]" checked={prefs.cloud === c} disabled={disabled} onChange={() => setTranslation({ cloud: c })} />
              <span><span className="font-medium">{SERVICE_LABEL[c]}</span><span className="block text-xs text-muted-foreground">{note}</span></span>
            </label>;
          })}
        </div>
      </div>

      <Toggle title="Translate automatically with the service too" id="tr-auto-cloud" checked={prefs.autoCloud} disabled={prefs.cloud === 'none' || !prefs.auto} onChange={v => setTranslation({ autoCloud: v })}
        detail={`Otherwise automatic translation only happens on this device, and the service only translates when you tap Translate. ${prefs.cloud === 'deepl' ? 'Each post counts toward your DeepL allowance.' : prefs.cloud === 'ai' ? 'Each post counts toward your AI provider’s usage.' : ''}`.trim()} />

      <div className="rounded-2xl border border-border p-4">
        <div className="flex flex-wrap items-center gap-3">
          <KeyRound className="size-4 text-muted-foreground" aria-hidden="true" />
          <span className="min-w-0 flex-1"><span className="block text-sm font-semibold">DeepL</span><span className="block text-xs text-muted-foreground">{deepl ? `Key ${deepl.hint} · ${deepl.plan === 'free' ? 'API Free' : 'API Pro'}` : 'Your own API key, Free or Pro'}</span></span>
          {deepl && <Button variant="ghost" size="icon" aria-label="Remove the DeepL key" disabled={t.busy} onClick={() => void t.removeDeepl()}><Trash2 /></Button>}
          <Button variant="outline" size="sm" className="rounded-full" onClick={() => setAdding(a => !a)}>{deepl ? 'Replace key' : 'Add key'}</Button>
        </div>
        {adding && <form className="mt-4 space-y-2" autoComplete="off" onSubmit={async e => { e.preventDefault(); setError(null); const err = await t.saveDeepl(key.trim()); if (err) setError(err); else { setKey(''); setAdding(false); } }}>
          <div className="flex gap-2">
            <Input type="password" value={key} onChange={e => setKey(e.target.value)} placeholder="DeepL authentication key" aria-label="DeepL API key" spellCheck={false} autoCapitalize="off" autoComplete="off" data-1p-ignore data-lpignore="true" />
            <Button type="submit" disabled={t.busy || key.trim().length < 16}>{t.busy ? 'Checking…' : 'Save'}</Button>
          </div>
          <p className="text-xs text-muted-foreground">{t.keys && !t.keys.serverKeys ? 'This Atlas server isn’t set up to keep keys.' : 'Checked with DeepL, then kept encrypted on Atlas’s server and only ever sent to DeepL. DeepL’s API doesn’t accept requests from a browser, so it can’t stay on this device.'}</p>
          <a href={DEEPL_KEY_URL} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground hover:underline">Get a DeepL API key (Free or Pro)<ArrowUpRight className="size-3" /></a>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        </form>}
      </div>
    </fieldset>
    <p className="mt-4 text-xs text-muted-foreground">These settings are kept on this device. The DeepL key is kept with your Atlas account.</p>
  </section>;
}

function Toggle({ title, detail, id, checked, disabled, onChange }: { title: string; detail: string; id: string; checked: boolean; disabled?: boolean; onChange: (v: boolean) => void }) {
  return <div className="flex items-start justify-between gap-6">
    <div><p className="text-sm font-semibold">{title}</p><p id={id} className="mt-1 text-sm leading-relaxed text-muted-foreground">{detail}</p></div>
    <Switch aria-label={title} aria-describedby={id} checked={checked} disabled={disabled} onCheckedChange={onChange} />
  </div>;
}
