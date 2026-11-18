/**
 * Translation and language detection on this device. Browser-only.
 *
 * - The browser's built-in Translator and LanguageDetector APIs (Chrome 138+ and Edge 148+ on desktop; not Android,
 *   iOS, Firefox or Safari: developer.chrome.com, "Translator API"). Once a language pack is on the device nothing is
 *   sent anywhere. Downloading one needs a user gesture (`navigator.userActivation`), so automatic translation never
 *   starts a download; a tap on Translate can.
 * - Language detection falls back to tinyld (MIT, github.com/komodojp/tinyld, loaded only when needed), as Phanpy
 *   does (src/components/status.jsx, detectLang): a guess under 50% confidence counts as none.
 */
type Availability = 'available' | 'downloadable' | 'downloading' | 'unavailable';
type TranslatorLike = { translate(text: string): Promise<string> };
type TranslatorApi = { availability(o: { sourceLanguage: string; targetLanguage: string }): Promise<Availability>; create(o: { sourceLanguage: string; targetLanguage: string }): Promise<TranslatorLike> };
type DetectorLike = { detect(text: string): Promise<{ detectedLanguage?: string; confidence?: number }[]> };
type DetectorApi = { availability(): Promise<Availability>; create(): Promise<DetectorLike> };

const api = <T>(name: string): T | null => (typeof self !== 'undefined' && name in self ? (self as unknown as Record<string, T>)[name] : null);
const gesture = () => typeof navigator !== 'undefined' && !!(navigator as Navigator & { userActivation?: { isActive: boolean } }).userActivation?.isActive;

/** Whether this browser can translate on the device at all. */
export const canTranslateOnDevice = () => !!api<TranslatorApi>('Translator');

/** Whether a language pair can be translated here now, after a download, or not at all. */
export async function onDeviceStatus(source: string, target: string): Promise<Availability> {
  const T = api<TranslatorApi>('Translator');
  if (!T) return 'unavailable';
  try { return await T.availability({ sourceLanguage: source, targetLanguage: target }); } catch { return 'unavailable'; }
}

const translators = new Map<string, Promise<TranslatorLike>>();

/** Translates texts in order on the device. A pair that needs its language pack is only downloaded during a tap. */
export async function translateOnDevice(texts: string[], source: string, target: string): Promise<{ texts: string[] } | { error: 'unavailable' | 'needs-download' | 'failed' }> {
  const T = api<TranslatorApi>('Translator');
  if (!T) return { error: 'unavailable' };
  const pair = `${source}>${target}`;
  if (!translators.has(pair)) {
    const status = await onDeviceStatus(source, target);
    if (status === 'unavailable') return { error: 'unavailable' };
    if (status !== 'available' && !gesture()) return { error: 'needs-download' };
    translators.set(pair, T.create({ sourceLanguage: source, targetLanguage: target }));
  }
  try {
    const t = await translators.get(pair)!;
    const out: string[] = [];
    for (const x of texts) out.push(x.trim() ? await t.translate(x) : x);
    return { texts: out };
  } catch {
    translators.delete(pair);
    return { error: 'failed' };
  }
}

let detector: Promise<DetectorLike | null> | null = null;

/** The language a text is written in, or null when no guess is confident (50% or more). */
export async function detectLanguage(text: string): Promise<string | null> {
  const t = text.trim().slice(0, 1000);
  if (t.length < 4) return null;
  const D = api<DetectorApi>('LanguageDetector');
  if (D) {
    detector ??= D.availability().then(a => (a === 'available' || gesture() ? D.create() : null)).catch(() => null);
    const d = await detector;
    if (!d) detector = null;
    else {
      try {
        const [top] = await d.detect(t);
        if (top?.detectedLanguage && top.detectedLanguage !== 'und' && (top.confidence ?? 0) >= 0.5) return top.detectedLanguage;
      } catch { /* fall back */ }
    }
  }
  try {
    // tinyld's light build (34 KB gzipped) settles clear cases; close languages (Spanish and Portuguese) need its
    // normal build (264 KB), loaded only then, once.
    const light = (await import('tinyld/light')).detectAll(t)[0];
    if (light?.lang && light.accuracy >= 0.5) return light.lang;
    const top = (await import('tinyld')).detectAll(t)[0];
    return top?.lang && top.accuracy >= 0.5 ? top.lang : null;
  } catch {
    return null;
  }
}
