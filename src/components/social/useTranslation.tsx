import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { Languages } from 'lucide-react';
import type { FedizenPost } from '@/lib/fedizen-feed';
import { getTranslationKeys, translateWithDeepl } from '@/lib/translation.functions';
import { browserCode, deeplSource, deeplTarget, languageName, TARGET_LANGUAGES } from '@/lib/translation/languages';
import { targetOf, useTranslationPrefs } from '@/lib/translation/prefs';
import { engines, noEngine, offer, type Engine } from '@/lib/translation/plan';
import { detectionText, translationJob, type Mode } from '@/lib/translation/segments';
import { canTranslateOnDevice, detectLanguage, onDeviceStatus, translateOnDevice } from '@/lib/translation/on-device';
import { PROVIDERS } from '@/lib/intelligence/providers';
import { useAtlasAuth } from './AuthState';
import { useAiRunner, useIntelligence } from './useIntelligence';

/**
 * Translating a post where it's shown (PostContent on desktop, MobilePostContent on the phone): its language (the
 * author's, else detected on this device once the post is on screen), the Translate button, automatic translation as
 * it comes into view, and the translated post shown in place of the original with "Show original" (lib/translation).
 */

type Done = { texts: string[]; mode: Mode; engine: Engine; detected?: string };
/** Translations already made, this session: a post's id, edit, target and source. */
const made = new Map<string, Done>();
const detected = new Map<string, string | null>();
/** One translation on the device at a time, as Phanpy queues them. */
let deviceQueue: Promise<unknown> = Promise.resolve();

export type PostTranslation = {
  /** Put on the post's element: language detection and automatic translation wait until it's on screen. */
  ref: (el: HTMLElement | null) => void;
  /** The post to draw: the translation, or the original. */
  shown: FedizenPost;
  /** The language of what's drawn, for `lang`. */
  shownLang?: string;
  line: TranslationLine | null;
};

export type TranslationLine =
  | { kind: 'offer'; source: string; download: boolean; run: () => void }
  | { kind: 'busy'; source: string }
  | { kind: 'done'; source: string; via: string; original: boolean; toggle: () => void; retranslate: (lang: string) => void }
  | { kind: 'problem'; source: string; message: string; settings: boolean; run: () => void };

const PROBLEM: Record<string, string> = {
  'bad-key': 'The translation key was refused.', quota: 'Your DeepL allowance for this period is used up.', 'rate-limited': 'Too many translations just now. Try again shortly.',
  'too-long': 'This post is too long to translate in one go.', unsupported: 'This language pair can’t be translated.', 'no-key': 'Add a key in Settings → Intelligence to translate with it.',
  'no-ai': 'Turn on Intelligence with a key to translate with it.', 'device-off': 'Translating on this device is off. Turn it on, or choose a service, in Settings → Intelligence.',
  private: 'Only public posts are sent to a translation service, and this browser can’t translate on the device.',
  'not-configured': 'This Atlas server can’t keep keys.', failed: 'The browser couldn’t translate it.', unavailable: 'Translation isn’t available right now.',
};

export function usePostTranslation(post: FedizenPost): PostTranslation {
  const prefs = useTranslationPrefs();
  const { user } = useAtlasAuth();
  const runner = useAiRunner();
  const ai = useIntelligence().data;
  const keysFn = useServerFn(getTranslationKeys), deeplFn = useServerFn(translateWithDeepl);
  const keys = useQuery({ queryKey: ['translation-keys', user?.id], queryFn: () => keysFn(), enabled: !!user && prefs.enabled && prefs.cloud === 'deepl', staleTime: 5 * 60_000 });
  const cloudReady = prefs.cloud === 'deepl' ? !!keys.data?.deepl : prefs.cloud === 'ai' ? runner.ready : false;
  const via = (e: Engine) => (e === 'device' ? 'on this device' : e === 'deepl' ? 'with DeepL' : `with ${ai?.active ? PROVIDERS[ai.active.provider].product : 'your AI provider'}`);

  const id = post.statusId ?? post.id;
  const [visible, setVisible] = useState(false);
  const observer = useRef<IntersectionObserver | null>(null);
  const ref = useCallback((el: HTMLElement | null) => {
    observer.current?.disconnect();
    if (!el || typeof IntersectionObserver === 'undefined') { if (el) setVisible(true); return; }
    observer.current = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setVisible(true); observer.current?.disconnect(); } }, { rootMargin: '200px 0px' });
    observer.current.observe(el);
  }, []);

  // The post's language: as its author set it, else detected here once it's on screen.
  const [found, setFound] = useState<string | null | undefined>(() => post.language ?? detected.get(id));
  useEffect(() => {
    if (post.language) { setFound(post.language); return; }
    if (!prefs.enabled || !visible || detected.has(id)) { if (detected.has(id)) setFound(detected.get(id)); return; }
    let live = true;
    void detectLanguage(detectionText(post)).then(l => { detected.set(id, l); if (live) setFound(l); });
    return () => { live = false; };
  }, [id, post, visible, prefs.enabled]);

  const target = targetOf(prefs);
  const [source, setSource] = useState<string | null>(null);
  const lang = source ?? found ?? null;
  const offered = offer(post, lang, prefs);
  const cacheKey = `${id}|${post.editedAt ?? ''}|${target}|${lang ?? ''}`;
  // A translation belongs to one version of the post, one target and one source: when any changes (an edit arrives,
  // the target is changed), it's no longer shown, and an answer still on its way for the old one is ignored.
  const [made1, setDone] = useState<(Done & { key: string }) | null>(null);
  // Turning translation off shows every post as written again, even ones already translated.
  const done = !prefs.enabled ? null : made1?.key === cacheKey ? made1 : made.get(cacheKey) ?? null;
  const latest = useRef(cacheKey);
  latest.current = cacheKey;
  const [original, setOriginal] = useState(false);
  /** `waiting`: automatic translation needs a language download, which only a tap may start. */
  const [state, setState] = useState<{ busy?: boolean; problem?: string; download?: boolean; waiting?: boolean }>({});
  useEffect(() => { setState(x => (x.busy ? x : {})); setOriginal(false); }, [cacheKey]);
  const device = canTranslateOnDevice();

  // A pair whose language pack isn't on this device yet: the button says the tap will download it.
  useEffect(() => {
    if (!offered || !device || !lang || !prefs.useDevice) return;
    let live = true;
    void onDeviceStatus(browserCode(lang), browserCode(target)).then(s => { if (live) setState(x => ({ ...x, download: s === 'downloadable' || s === 'downloading' })); });
    return () => { live = false; };
  }, [offered, device, lang, target, prefs.useDevice]);

  const run = useCallback(async (manual: boolean, from = lang) => {
    if (!from) return;
    const list = engines(post, prefs, { manual, device, cloudReady });
    if (!list.length) { if (manual) setState({ problem: noEngine(post, prefs, { device, cloudReady }) }); return; }
    const key = `${id}|${post.editedAt ?? ''}|${target}|${from}`;
    const cached = made.get(key);
    if (cached) { setDone({ ...cached, key }); setOriginal(false); return; }
    setState({ busy: true });
    let last = 'unavailable';
    for (const e of list) {
      const mode: Mode = e === 'device' ? 'plain' : 'html';
      const job = translationJob(post, mode);
      let r: { texts: string[]; detected?: string } | { error: string };
      if (e === 'device') {
        const go = () => translateOnDevice(job.texts, browserCode(from), browserCode(target));
        // During a tap, start at once (a download needs the gesture); otherwise wait in line.
        r = manual ? await go() : await (deviceQueue = deviceQueue.then(go, go)) as Awaited<ReturnType<typeof go>>;
      } else if (e === 'deepl') {
        r = await deeplFn({ data: { expectedAtlasUserId: user!.id, texts: job.texts, target: deeplTarget(target), ...(source || post.language ? { source: deeplSource(from) } : {}) } }).catch(() => ({ error: 'unavailable' }));
      } else {
        r = await runner.translate({ texts: job.texts, target, ...(source || post.language ? { source: from } : {}) });
      }
      if ('texts' in r) {
        const d: Done = { texts: r.texts, mode, engine: e, ...(r.detected ? { detected: r.detected } : {}) };
        made.set(key, d);
        // The post was edited or the target changed meanwhile: keep the answer for later, show nothing stale.
        if (latest.current !== key && from === lang) return;
        setDone({ ...d, key }); setOriginal(false); setState({});
        return;
      }
      last = r.error;
      if (r.error === 'needs-download' && !manual) { setState({ download: true, waiting: true }); return; }
    }
    if (latest.current !== key && from === lang) return;
    setState({ problem: last });
  }, [lang, post, prefs, device, cloudReady, id, target, source, deeplFn, user, runner]);

  // Automatically, once it's on screen.
  useEffect(() => {
    if (!prefs.auto || !offered || !visible || done || state.busy || state.problem || state.waiting) return;
    void run(false);
  }, [prefs.auto, offered, visible, done, state.busy, state.problem, state.waiting, run]);

  const shown = useMemo(() => {
    if (!done || original) return post;
    try { return translationJob(post, done.mode).build(done.texts); } catch { return post; }
  }, [done, original, post]);

  const sourceName = lang ? languageName(done?.detected && !source && !post.language ? done.detected : lang) : '';
  let line: TranslationLine | null = null;
  if (done) line = { kind: 'done', source: sourceName, via: via(done.engine), original, toggle: () => setOriginal(o => !o), retranslate: l => { setSource(l); void run(true, l); } };
  else if (!offered) line = null;
  else if (state.busy) line = { kind: 'busy', source: sourceName };
  else if (state.problem) line = { kind: 'problem', source: sourceName, message: state.problem === 'setup' ? 'This browser can’t translate on the device. Choose a translation service in Settings → Intelligence.' : PROBLEM[state.problem] ?? PROBLEM.unavailable, settings: ['setup', 'no-key', 'no-ai', 'device-off'].includes(state.problem), run: () => void run(true) };
  else line = { kind: 'offer', source: sourceName, download: !!state.download && prefs.useDevice && device, run: () => void run(true) };

  return { ref, shown, shownLang: done && !original ? target : post.language, line };
}

/** Languages to choose from when the detected one is wrong. */
export const SOURCE_CHOICES = [...TARGET_LANGUAGES];

/** The line under a post: Translate, or "Translated from Japanese · on this device · Show original". */
export function TranslationLineView({ line, onSettings, className }: { line: TranslationLine | null; onSettings: () => void; className?: string }) {
  if (!line) return null;
  const cls = ['atlas-tr', className].filter(Boolean).join(' ');
  if (line.kind === 'offer') return <div className={cls}>
    <button type="button" className="atlas-tr-btn" onClick={line.run}><Languages aria-hidden="true" />Translate from {line.source}</button>
    {line.download && <span className="atlas-tr-note">Downloads {line.source} to this device once</span>}
  </div>;
  if (line.kind === 'busy') return <div className={cls} aria-live="polite"><span className="atlas-tr-note"><Languages aria-hidden="true" />Translating from {line.source}…</span></div>;
  if (line.kind === 'problem') return <div className={cls} role="status">
    <span className="atlas-tr-note">{line.message}</span>
    {line.settings ? <button type="button" className="atlas-tr-link" onClick={onSettings}>Settings</button> : <button type="button" className="atlas-tr-link" onClick={line.run}>Try again</button>}
  </div>;
  return <div className={cls}>
    <span className="atlas-tr-note"><Languages aria-hidden="true" />{line.original ? <>Written in </> : <>Translated from </>}
      <label className="atlas-tr-source"><span className="sr-only">Language it’s written in</span>
        <select value="" onChange={e => { if (e.target.value) line.retranslate(e.target.value); }} aria-label={`Translated from ${line.source}. Choose another language if that’s wrong`}>
          <option value="">{line.source}</option>
          {SOURCE_CHOICES.map(l => <option key={l} value={l}>{languageName(l)}</option>)}
        </select>
      </label>
      {!line.original && <> · {line.via}</>}
    </span>
    <button type="button" className="atlas-tr-link" onClick={line.toggle}>{line.original ? 'Show translation' : 'Show original'}</button>
  </div>;
}
