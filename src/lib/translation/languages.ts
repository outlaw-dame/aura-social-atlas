/**
 * Languages for translation. Browser-safe and pure.
 *
 * Tags are BCP 47 as Mastodon gives a post's `language` (`ja`, `pt-BR`, `zh-Hant`). Two tags are the same language
 * when their primary subtags match — except Chinese, where the script decides (Simplified and Traditional are read by
 * different people), worked out from the script or region when the tag gives one.
 */

/** The primary subtag, lower case: `pt-BR` → `pt`. */
export function baseOf(tag: string): string {
  return tag.trim().split(/[-_]/)[0].toLowerCase();
}

/** Chinese as `zh-Hans` or `zh-Hant` (from the script, else the region), other languages as their primary subtag. */
export function readingKey(tag: string): string {
  const base = baseOf(tag);
  if (base !== 'zh') return base;
  const parts = tag.split(/[-_]/).slice(1).map(p => p.toLowerCase());
  if (parts.includes('hant') || parts.some(p => ['tw', 'hk', 'mo'].includes(p))) return 'zh-Hant';
  return 'zh-Hans';
}

export const sameLanguage = (a: string, b: string) => readingKey(a) === readingKey(b);

/** A language's name in the reader's language (`ja` → "Japanese"), falling back to the tag. */
export function languageName(tag: string, display = (typeof navigator === 'undefined' ? 'en' : navigator.language) ?? 'en'): string {
  try {
    return new Intl.DisplayNames([display], { type: 'language' }).of(tag) ?? tag;
  } catch {
    return tag;
  }
}

/** The languages a browser says its person reads, once each, most preferred first (`navigator.languages`). */
export function browserLanguages(list: readonly string[] = (typeof navigator === 'undefined' ? undefined : navigator.languages ?? [navigator.language]) ?? ['en']): string[] {
  const out: string[] = [];
  for (const t of list) {
    if (!t) continue;
    const k = readingKey(t);
    if (!out.includes(k)) out.push(k);
  }
  return out.length ? out : ['en'];
}

/**
 * Languages to translate into, offered in Settings. The languages DeepL translates into (its documented targets) and
 * Chrome's built-in translator mostly share; a pair either engine can't do is reported when it's tried.
 */
export const TARGET_LANGUAGES = [
  'ar', 'bg', 'cs', 'da', 'de', 'el', 'en', 'es', 'et', 'fi', 'fr', 'he', 'hu', 'id', 'it', 'ja', 'ko', 'lt', 'lv', 'nb',
  'nl', 'pl', 'pt', 'ro', 'ru', 'sk', 'sl', 'sv', 'th', 'tr', 'uk', 'vi', 'zh-Hans', 'zh-Hant',
] as const;

/**
 * DeepL's code for a target language (Request translation, `target_lang`): English and Portuguese need a variant
 * (EN-US / EN-GB, PT-BR / PT-PT), Chinese a script (ZH-HANS / ZH-HANT); the rest are the primary subtag in capitals.
 * `region` is the reader's own locale, which picks the variant.
 */
export function deeplTarget(tag: string, region = (typeof navigator === 'undefined' ? '' : navigator.language) ?? ''): string {
  const base = baseOf(tag);
  const r = (tag.includes('-') ? tag : region).toLowerCase();
  if (base === 'en') return /-(gb|ie|au|nz|za|in)\b/.test(r) ? 'EN-GB' : 'EN-US';
  if (base === 'pt') return /-pt\b/.test(r) ? 'PT-PT' : 'PT-BR';
  if (base === 'zh') return readingKey(tag) === 'zh-Hant' ? 'ZH-HANT' : 'ZH-HANS';
  return base.toUpperCase();
}

/** DeepL's code for a source language (`source_lang`): the primary subtag in capitals. */
export const deeplSource = (tag: string) => baseOf(tag).toUpperCase();

/** What the browser's Translator API takes: the primary subtag, or `zh` / `zh-Hant` for Chinese. */
export function browserCode(tag: string): string {
  const k = readingKey(tag);
  return k === 'zh-Hans' ? 'zh' : k;
}
