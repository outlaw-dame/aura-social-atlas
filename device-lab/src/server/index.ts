/**
 * The Device Lab's "server": every server function the phone app calls, answered from sample data, in the shapes the
 * real functions return (each handler is typed against the real function's result, so `bun run lab:check` fails when
 * the app's shapes change). Writes (like, save, join, follow, post…) change the sample data for this page load only.
 */
import { bonfire, bonfirePrivate, collections, fediProfile, fedizen, groups, intelligence, push, spotlight, translation, voices } from './handlers';

type Mod = Record<string, ((data: unknown) => unknown) | undefined>;
const MODULES: Record<string, Mod> = {
  bonfire: bonfire as Mod,
  'bonfire-private': bonfirePrivate as Mod,
  collections: collections as Mod,
  'fedi-profile': fediProfile as Mod,
  fedizen: fedizen as Mod,
  groups: groups as Mod,
  intelligence: intelligence as Mod,
  push: push as Mod,
  spotlight: spotlight as Mod,
  translation: translation as Mod,
  voices: voices as Mod,
};

const EXTRAS: Record<string, unknown> = {
  'bonfire-private.nativeBonfireReadEnabled': () => false,
};

/** Network-like delay, so loading states show as they do in the app. */
const wait = (ms: number) => new Promise(r => setTimeout(r, ms));
const missing = new Set<string>();

export function labFn(key: string) {
  const [mod, name] = key.split('.');
  return async (opts?: { data?: unknown }) => {
    await wait(120 + Math.random() * 180);
    const h = MODULES[mod]?.[name];
    if (!h) {
      if (!missing.has(key)) { missing.add(key); console.warn(`[device-lab] no sample answer for ${key}`); }
      throw new Error(`Not available in the Device Lab: ${key}`);
    }
    // A copy, as from the network: the app may keep and change what it gets.
    return structuredClone(await h(opts?.data));
  };
}

export function labExtra(key: string) {
  if (!(key in EXTRAS)) console.warn(`[device-lab] no stand-in for ${key}`);
  return EXTRAS[key];
}
