/**
 * Device simulation for the Lab: makes this page report the device the Lab picked, before the app reads it.
 * The app's own detection (src/lib/device-profile.ts readEnv/watchDeviceProfile) then runs unmodified on what it
 * sees: user agent and client hints, touch points, screen size, pointer and display-mode queries, device posture and
 * viewport segments. The window size is the Lab's device frame itself. Safe-area insets come from CSS env(), which a
 * page can't set, so they show only on a real device.
 *
 * ?p=<preset>&o=portrait|landscape picks the device (presets.js, shared with the Lab bench); the bench sends
 * { type: 'atlas-sim', key, o } to change it in place (folding and unfolding the iPhone Duo without a reload).
 */
type Env = { ua: string; uad: { platform?: string; mobile?: boolean } | null; touchPoints: number; screenW: number; screenH: number; coarse: boolean; anyFine: boolean; display: string; posture: 'continuous' | 'folded'; segs: { x: number; y: number; width: number; height: number }[] | null; landscape: boolean };
type Presets = { PRESETS: Record<string, unknown>; presetEnv: (key: string, o: string, standalone: boolean, w: number, h: number) => Env };

const presets = (window as unknown as { AtlasPresets?: Presets }).AtlasPresets;
const q = new URLSearchParams(location.search);
let env: Env | null = null;
/** Opened as an installed app (the bench's "Opened as"), for display-mode: standalone. */
let standalone = q.get('sa') === '1';

function envFor(key: string | null, o: string | null): Env | null {
  if (!presets || !key || !presets.PRESETS[key]) return null;
  return presets.presetEnv(key, o || 'portrait', standalone, innerWidth, innerHeight);
}

type Listener = (e: { matches: boolean; media: string }) => void;
const lists = new Map<string, { media: string; listeners: Set<Listener>; last: boolean }>();
const FAKE = /^\((pointer: coarse|any-pointer: fine|display-mode: [\w-]+|device-posture: folded|horizontal-viewport-segments: 2|vertical-viewport-segments: 2)\)$/;

function answer(media: string): boolean {
  const e = env!;
  const m = media.slice(1, -1);
  if (m === 'pointer: coarse') return e.coarse;
  if (m === 'any-pointer: fine') return e.anyFine;
  if (m.startsWith('display-mode: ')) return m.slice(14) === e.display;
  if (m === 'device-posture: folded') return e.posture === 'folded';
  if (m === 'horizontal-viewport-segments: 2') return !!e.segs && e.segs[1].x > e.segs[0].x + 0.5;
  if (m === 'vertical-viewport-segments: 2') return !!e.segs && e.segs[1].y > e.segs[0].y + 0.5;
  return false;
}

function install() {
  const realMatch = window.matchMedia.bind(window);
  window.matchMedia = (media: string) => {
    if (!env || !FAKE.test(media.trim())) return realMatch(media);
    const key = media.trim();
    let l = lists.get(key);
    if (!l) { l = { media: key, listeners: new Set(), last: answer(key) }; lists.set(key, l); }
    const entry = l;
    return {
      media: key, get matches() { return answer(key); }, onchange: null,
      addEventListener: (_t: string, f: Listener) => entry.listeners.add(f), removeEventListener: (_t: string, f: Listener) => entry.listeners.delete(f),
      addListener: (f: Listener) => entry.listeners.add(f), removeListener: (f: Listener) => entry.listeners.delete(f), dispatchEvent: () => true,
    } as unknown as MediaQueryList;
  };
  const nav = navigator as unknown as Record<string, unknown>;
  const define = (o: object, k: string, get: () => unknown) => { try { Object.defineProperty(o, k, { configurable: true, get }); } catch { /* read-only here */ } };
  define(nav, 'userAgent', () => env!.ua);
  define(nav, 'userAgentData', () => env!.uad);
  define(nav, 'maxTouchPoints', () => env!.touchPoints);
  define(nav, 'standalone', () => env!.display === 'standalone');
  const posture = new EventTarget();
  define(posture, 'type', () => env!.posture);
  define(nav, 'devicePosture', () => posture);
  define(screen, 'width', () => env!.screenW);
  define(screen, 'height', () => env!.screenH);
  const orientation = new EventTarget();
  define(orientation, 'type', () => (env!.landscape ? 'landscape-primary' : 'portrait-primary'));
  define(screen, 'orientation', () => orientation);
  define(window, 'viewport', () => ({ segments: env!.segs }));
  return posture;
}

if (q.get('p')) {
  env = envFor(q.get('p'), q.get('o'));
  if (env) {
    const posture = install();
    window.addEventListener('message', e => {
      const d = e.data as { type?: string; key?: string; o?: string; sa?: string } | null;
      if (e.source !== window.parent || d?.type !== 'atlas-sim' || !d.key) return;
      // The frame resizes first; read the new size a moment later.
      setTimeout(() => {
        standalone = d.sa === '1';
        const next = envFor(d.key!, d.o ?? 'portrait');
        if (!next) return;
        env = next;
        lists.forEach(l => { const now = answer(l.media); if (now !== l.last) { l.last = now; l.listeners.forEach(f => f({ matches: now, media: l.media })); } });
        posture.dispatchEvent(new Event('change'));
        window.dispatchEvent(new Event('resize'));
      }, 40);
    });
  }
}

export const simulated = !!env;
