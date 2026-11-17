import { useSyncExternalStore } from 'react';
import { browserLanguages, readingKey, TARGET_LANGUAGES } from './languages';

/**
 * Translation settings (Settings → Intelligence → Translation), kept on this device, as Atlas keeps its reading
 * preferences (reading-prefs.ts): Fedizen has nowhere to keep them. From Phanpy (src/pages/settings.jsx): translation
 * on by default, a target language that defaults to the browser's, languages never to translate ("Hide Translate
 * button for"), and automatic translation. Atlas adds languages always translated automatically, and which cloud
 * service may be used — none until the person picks one.
 */
export type CloudEngine = 'none' | 'deepl' | 'ai';
export type TranslationPrefs = {
  /** Offer translation at all. */ enabled: boolean;
  /** The language to translate into; unset follows the browser. */ target?: string;
  /** Languages the person reads: never offered for translation. Unset follows the browser's languages. */ read?: string[];
  /** Translate posts in another language automatically as they come into view. */ auto: boolean;
  /** Let automatic translation use the cloud service too; otherwise it only happens on this device. */ autoCloud: boolean;
  /** Translate on this device when the browser can. */ useDevice: boolean;
  /** The cloud service used when this device can't translate (or for every post when `useDevice` is off). */ cloud: CloudEngine;
};

export const DEFAULT_TRANSLATION: TranslationPrefs = { enabled: true, auto: true, autoCloud: false, useDevice: true, cloud: 'none' };
const KEY = 'atlas-translation';
const TAG = /^[a-z]{2,3}(-[A-Za-z]{4})?$/;

export function parseTranslation(raw: string | null): TranslationPrefs {
  try {
    const v = raw ? JSON.parse(raw) as Partial<TranslationPrefs> : {};
    const langs = (x: unknown) => Array.isArray(x) ? [...new Set(x.filter((t): t is string => typeof t === 'string' && TAG.test(t)).map(readingKey))].slice(0, 30) : undefined;
    return {
      enabled: v.enabled !== false,
      ...(typeof v.target === 'string' && (TARGET_LANGUAGES as readonly string[]).includes(v.target) ? { target: v.target } : {}),
      ...(langs(v.read) ? { read: langs(v.read) } : {}),
      auto: v.auto !== false,
      autoCloud: v.autoCloud === true,
      useDevice: v.useDevice !== false,
      cloud: v.cloud === 'deepl' || v.cloud === 'ai' ? v.cloud : 'none',
    };
  } catch { return DEFAULT_TRANSLATION; }
}

/** The language posts are translated into: the setting, else the browser's first language Atlas can translate to. */
export function targetOf(p: TranslationPrefs, browser = browserLanguages()): string {
  if (p.target) return p.target;
  return browser.find(l => (TARGET_LANGUAGES as readonly string[]).includes(l)) ?? 'en';
}

/** The languages the person reads: the setting, else the browser's — with the target always among them. */
export function readOf(p: TranslationPrefs, browser = browserLanguages()): string[] {
  const list = p.read ?? browser;
  const t = readingKey(targetOf(p, browser));
  return list.includes(t) ? list : [t, ...list];
}

let current: TranslationPrefs | null = null;
const listeners = new Set<() => void>();
function read(): TranslationPrefs {
  if (current) return current;
  try { current = parseTranslation(typeof localStorage === 'undefined' ? null : localStorage.getItem(KEY)); } catch { current = DEFAULT_TRANSLATION; }
  return current;
}

export function setTranslation(patch: Partial<TranslationPrefs>) {
  current = parseTranslation(JSON.stringify({ ...read(), ...patch }));
  try { localStorage.setItem(KEY, JSON.stringify(current)); } catch { /* per-device convenience only */ }
  listeners.forEach(l => l());
}

export function useTranslationPrefs(): TranslationPrefs {
  return useSyncExternalStore(l => { listeners.add(l); return () => { listeners.delete(l); }; }, read, () => DEFAULT_TRANSLATION);
}
