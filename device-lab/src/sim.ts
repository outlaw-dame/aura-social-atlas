/**
 * Device simulation for the Lab: makes this page report the device the Lab picked, before the app reads it.
 * The app's own detection (src/lib/device-profile.ts readEnv/watchDeviceProfile) then runs unmodified on what it
 * sees: user agent and client hints, touch points, screen size, pointer and display-mode queries, device posture and
 * viewport segments. The window size is the Lab's device frame itself. Safe-area insets come from CSS env(), which a
 * page can't set, so the Lab pins every inset Atlas and Framework7 read to the preset's own figures (presets.js
 * `insets`, or none): otherwise iOS hands the frame the viewer's own phone's insets and the simulated device's bars
 * sit a status bar too low.
 *
 * ?p=<preset>&o=portrait|landscape picks the device (presets.js, shared with the Lab bench); the bench sends
 * { type: 'atlas-sim', key, o } to change it in place (folding and unfolding the iPhone Duo without a reload).
 */
type Env = { ua: string; uad: { platform?: string; mobile?: boolean } | null; touchPoints: number; screenW: number; screenH: number; coarse: boolean; anyFine: boolean; display: string; posture: 'continuous' | 'folded'; segs: { x: number; y: number; width: number; height: number }[] | null; landscape: boolean };
export type Insets = { top: number; right: number; bottom: number; left: number };
type Presets = { PRESETS: Record<string, { insets?: Record<string, Insets> }>; presetEnv: (key: string, o: string, standalone: boolean, w: number, h: number) => Env };

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

const NONE: Insets = { top: 0, right: 0, bottom: 0, left: 0 };
/** The insets the Lab pins for this preset, and whether they are the device's real figures. */
export let pinned: { insets: Insets; known: boolean } = { insets: NONE, known: false };

/**
 * Replaces env(safe-area-inset-*) everywhere it reaches the app: Framework7's --f7-safe-area-* (at the root for top and
 * bottom; on .safe-areas, panels, popups and sheets for the sides) and Atlas's --atlas-sa-*. The "no-safe-area" opt-outs
 * stay at zero.
 */
function pinInsets(key: string, o: string) {
  const known = presets?.PRESETS[key]?.insets?.[o];
  const i = known ?? NONE;
  pinned = { insets: i, known: !!known };
  const px = (n: number) => `${n}px !important`;
  const css = `:root {
  --f7-safe-area-top: ${px(i.top)}; --f7-safe-area-bottom: ${px(i.bottom)};
  --atlas-sa-top: ${px(i.top)}; --atlas-sa-right: ${px(i.right)}; --atlas-sa-bottom: ${px(i.bottom)}; --atlas-sa-left: ${px(i.left)};
}
:root .ios-left-edge, :root .ios-edges, :root .safe-area-left, :root .safe-areas, :root .popup, :root .sheet-modal, :root .panel-left {
  --f7-safe-area-left: ${px(i.left)}; --f7-safe-area-outer-left: ${px(i.left)};
}
:root .ios-right-edge, :root .ios-edges, :root .safe-area-right, :root .safe-areas, :root .popup, :root .sheet-modal, :root .panel-right {
  --f7-safe-area-right: ${px(i.right)}; --f7-safe-area-outer-right: ${px(i.right)};
}
:root .no-safe-areas, :root .no-safe-area-left, :root .no-ios-edges, :root .no-ios-left-edge { --f7-safe-area-left: 0px !important; --f7-safe-area-outer-left: 0px !important; }
:root .no-safe-areas, :root .no-safe-area-right, :root .no-ios-edges, :root .no-ios-right-edge { --f7-safe-area-right: 0px !important; --f7-safe-area-outer-right: 0px !important; }`;
  let el = document.getElementById('atlas-lab-insets') as HTMLStyleElement | null;
  if (!el) { el = document.createElement('style'); el.id = 'atlas-lab-insets'; }
  el.textContent = css;
  // Last in <head>, after the app's own styles, whenever they arrive.
  (document.head || document.documentElement).appendChild(el);
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
    pinInsets(q.get('p')!, q.get('o') || 'portrait');
    // Vite injects the app's stylesheets after this script runs; keep the pin last.
    new MutationObserver(() => { const el = document.getElementById('atlas-lab-insets'); if (el && el !== document.head.lastElementChild) document.head.appendChild(el); })
      .observe(document.head, { childList: true });
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
        pinInsets(d.key!, d.o ?? 'portrait');
        lists.forEach(l => { const now = answer(l.media); if (now !== l.last) { l.last = now; l.listeners.forEach(f => f({ matches: now, media: l.media })); } });
        posture.dispatchEvent(new Event('change'));
        window.dispatchEvent(new Event('resize'));
      }, 40);
    });
  }
}

export const simulated = !!env;
