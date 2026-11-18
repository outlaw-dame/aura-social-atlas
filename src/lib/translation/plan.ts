import type { FedizenPost } from '../fedizen-feed';
import { sameLanguage } from './languages';
import { readOf, targetOf, type TranslationPrefs } from './prefs';

/**
 * When Atlas offers to translate a post, when it does so by itself, and with what. Pure.
 *
 * - Offered (a Translate button) for a post in a language the person doesn't read (Phanpy: different from the target
 *   and not in "Hide Translate button for").
 * - Automatic, as the post comes into view, when "Translate automatically" is on: on this device whenever it can;
 *   through the cloud service only when the person allowed that too. Unlike Phanpy's inline translation, posts of any
 *   length, with content warnings, polls and links, are translated whole.
 * - A post that isn't public or unlisted is only ever translated on this device, as Mastodon's own translation only
 *   takes public and unlisted posts and Atlas never sends direct messages to an AI.
 */
export type Engine = 'device' | 'deepl' | 'ai';

export const canLeaveDevice = (p: FedizenPost) => p.visibility === 'public' || p.visibility === 'unlisted';

export function hasWords(p: FedizenPost): boolean {
  return !p.tombstone && [p.cw ?? '', ...p.paragraphs].some(t => /\p{L}/u.test(t));
}

/** Whether to offer translating a post written in `lang`. */
export function offer(p: FedizenPost, lang: string | null | undefined, prefs: TranslationPrefs, browser?: string[]): boolean {
  if (!prefs.enabled || !lang || !hasWords(p)) return false;
  return !readOf(prefs, browser).some(r => sameLanguage(r, lang)) && !sameLanguage(targetOf(prefs, browser), lang);
}

/** The engines to try, in order. `manual`: the person tapped Translate (a download may start; cloud is allowed). */
export function engines(p: FedizenPost, prefs: TranslationPrefs, o: { manual: boolean; device: boolean; cloudReady: boolean }): Engine[] {
  const out: Engine[] = [];
  if (prefs.useDevice && o.device) out.push('device');
  if (prefs.cloud !== 'none' && o.cloudReady && canLeaveDevice(p) && (o.manual || prefs.autoCloud)) out.push(prefs.cloud);
  return out;
}

/** Why a tap on Translate has nothing to translate with (engines() is empty), so the line can say what to change. */
export function noEngine(p: FedizenPost, prefs: TranslationPrefs, o: { device: boolean; cloudReady: boolean }): 'private' | 'no-key' | 'no-ai' | 'device-off' | 'setup' {
  if (prefs.cloud !== 'none' && o.cloudReady && !canLeaveDevice(p)) return 'private';
  if (prefs.cloud !== 'none' && !o.cloudReady) return prefs.cloud === 'deepl' ? 'no-key' : 'no-ai';
  return o.device && !prefs.useDevice ? 'device-off' : 'setup';
}
