/**
 * Device profile for the Framework7 phone app (/app).
 *
 * Layout is decided from the window and the fold only — size classes, viewport
 * segments and device posture — following Apple's iPhone Duo guidance ("use size
 * classes, not device or orientation checks") and WebKit's ("avoid UA sniffing;
 * use feature detection"). Device identity is still detected, but it only picks
 * the Framework7 theme (iOS or Material) and labels the device for diagnostics.
 *
 * `detectProfile` is a pure function of an `DeviceEnv` snapshot, so it is unit
 * tested with the raw environment each device reports (tests/device-profile.test.ts).
 */

export type OS =
  "ios" | "ipados" | "android" | "macos" | "windows" | "chromeos" | "linux" | "other";
export type Form = "phone" | "iphone-duo" | "foldable" | "tablet" | "desktop";
export type Fold = "cover" | "open" | "split" | null;
export type Span = "none" | "columns" | "rows";
export type Layout = "compact" | "regular" | "expanded" | "tabletop";
export type Nav = "tabbar" | "tabbar-side" | "rail" | "sidebar" | "deck";
export type Panes = "single" | "flat" | "fold";
export type DisplayMode =
  "browser" | "standalone" | "fullscreen" | "minimal-ui" | "window-controls-overlay";

export interface Segment {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DeviceEnv {
  ua: string;
  uad: { platform?: string; mobile?: boolean } | null;
  touchPoints: number;
  screenW: number;
  screenH: number;
  innerW: number;
  innerH: number;
  coarse: boolean;
  anyFine: boolean;
  display: DisplayMode;
  posture: "continuous" | "folded";
  segs: Segment[] | null;
  landscape: boolean;
}

export interface DeviceProfile {
  os: OS;
  form: Form;
  fold: Fold;
  input: "touch" | "hybrid" | "pointer";
  display: DisplayMode;
  posture: "continuous" | "folded";
  segs: Segment[] | null;
  span: Span;
  width: number;
  height: number;
  layout: Layout;
  nav: Nav;
  panes: Panes;
  theme: "ios" | "md";
}

/* Size-class thresholds (CSS px). */
export const REGULAR_MIN_W = 600;
export const REGULAR_MIN_H = 480;
export const EXPANDED_MIN_W = 1100;
export const PANES_MIN_W = 840;

function detectOS(ua: string, uad: DeviceEnv["uad"], touchPoints: number): OS {
  const p = (uad?.platform ?? "").toLowerCase();
  if (p === "android" || /Android/i.test(ua)) return "android";
  if (/iPhone|iPod/.test(ua)) return "ios";
  // iPadOS "desktop-class" Safari reports as a Mac; touch points give it away.
  if (/iPad/.test(ua) || (/Macintosh/.test(ua) && touchPoints > 1)) return "ipados";
  if (p === "chrome os" || p === "chromeos" || /CrOS/.test(ua)) return "chromeos";
  if (p === "windows" || /Windows/.test(ua)) return "windows";
  if (p === "macos" || /Macintosh|Mac OS X/.test(ua)) return "macos";
  if (p === "linux" || /Linux/.test(ua)) return "linux";
  return "other";
}

function spanOf(segs: Segment[] | null): Span {
  if (!segs || segs.length < 2) return "none";
  return segs[1].x > segs[0].x + 0.5 ? "columns" : "rows";
}

/** Layout from the window and the fold only. */
export function pickLayout(
  width: number,
  height: number,
  span: Span,
): { layout: Layout; nav: Nav; panes: Panes } {
  if (span === "rows") return { layout: "tabletop", nav: "deck", panes: "single" };
  const regular = width >= REGULAR_MIN_W && height >= REGULAR_MIN_H;
  const layout: Layout = !regular ? "compact" : width >= EXPANDED_MIN_W ? "expanded" : "regular";
  const nav: Nav =
    layout === "compact"
      ? width > height
        ? "tabbar-side"
        : "tabbar"
      : layout === "regular"
        ? "rail"
        : "sidebar"; // never depends on the fold: folding changes only the panes
  const panes: Panes =
    span === "columns" ? "fold" : layout !== "compact" && width >= PANES_MIN_W ? "flat" : "single";
  return { layout, nav, panes };
}

/** Pure: environment snapshot → profile. */
export function detectProfile(env: DeviceEnv): DeviceProfile {
  const { ua, uad, touchPoints } = env;
  const short = Math.min(env.screenW, env.screenH);
  const long = Math.max(env.screenW, env.screenH);
  const aspect = long / Math.max(short, 1);
  const input = env.coarse
    ? env.anyFine
      ? "hybrid"
      : "touch"
    : touchPoints > 0
      ? "hybrid"
      : "pointer";
  let os = detectOS(ua, uad, touchPoints);
  // An iPhone Duo with "Request Desktop Website" also reports as a touch Mac; iPads are ≥ 744 pt on the short side.
  if (os === "ipados" && short < 700) os = "ios";
  const screenWNow = env.landscape ? long : short;

  let form: Form = "desktop";
  let fold: Fold = null;
  if (os === "ios") {
    // iPhone Duo: both displays are ~4:3; other iPhones are ~19.5:9 (SE: 16:9 ≈ 1.78).
    if (aspect < 1.7) {
      form = "iphone-duo";
      fold = short < 520 ? "cover" : env.innerW < screenWNow * 0.7 ? "split" : "open";
    } else form = "phone";
  } else if (os === "ipados") {
    form = "tablet";
  } else if (os === "android") {
    const mobile = typeof uad?.mobile === "boolean" ? uad.mobile : /Mobile/i.test(ua);
    if (env.segs || env.posture === "folded") {
      form = "foldable";
      fold = "open";
    } else if (mobile) {
      if (short >= 560 && aspect < 1.6) {
        form = "foldable";
        fold = "open";
      } else form = "phone";
    } else form = "tablet";
  } else if (input === "touch") {
    form = "tablet"; // Windows / ChromeOS convertibles with no fine pointer attached
  }

  const span = spanOf(env.segs);
  return {
    os,
    form,
    fold,
    input,
    display: env.display,
    posture: env.posture,
    segs: env.segs,
    span,
    width: env.innerW,
    height: env.innerH,
    ...pickLayout(env.innerW, env.innerH, span),
    theme: os === "android" ? "md" : "ios",
  };
}

const NAMES: Record<Form, Partial<Record<OS, string>>> = {
  phone: { ios: "iPhone", android: "Android phone" },
  "iphone-duo": { ios: "iPhone Duo" },
  foldable: { android: "Android foldable" },
  tablet: {
    ipados: "iPad",
    android: "Android tablet",
    windows: "Windows tablet",
    chromeos: "Chromebook (tablet)",
  },
  desktop: { macos: "Mac", windows: "Windows PC", linux: "Linux desktop", chromeos: "Chromebook" },
};
const FOLDS = { cover: "cover display", open: "inner display", split: "Split View" } as const;

export function describeProfile(p: DeviceProfile): string {
  const name = NAMES[p.form][p.os] ?? (p.form === "desktop" ? "Desktop" : p.form);
  return p.fold ? `${name} · ${FOLDS[p.fold]}` : name;
}

/* ── Browser glue ─────────────────────────────────────────────────────────── */

type ViewportSegments = { segments?: ArrayLike<DOMRect> | null };

function mq(q: string): boolean {
  try {
    return window.matchMedia(q).matches;
  } catch {
    return false;
  }
}

/** Viewport Segments API: Chromium ships window.viewport.segments; an older draft used visualViewport.segments.
 *  Safari 27.1 has it behind a feature flag. */
function readSegments(): Segment[] | null {
  try {
    const w = window as unknown as {
      viewport?: ViewportSegments;
      visualViewport?: ViewportSegments;
    };
    const src = w.viewport?.segments ?? w.visualViewport?.segments;
    if (!src || src.length < 2) return null;
    return Array.from(src, (r) => ({ x: r.x, y: r.y, width: r.width, height: r.height }));
  } catch {
    return null;
  }
}

function readPosture(): "continuous" | "folded" {
  try {
    const dp = (navigator as unknown as { devicePosture?: { type?: string } }).devicePosture;
    if (dp?.type === "folded") return "folded";
    if (dp?.type) return "continuous";
  } catch {
    /* not supported */
  }
  return mq("(device-posture: folded)") ? "folded" : "continuous";
}

function readLandscape(): boolean {
  try {
    if (screen.orientation?.type) return screen.orientation.type.startsWith("landscape");
  } catch {
    /* not supported */
  }
  const legacy = (window as unknown as { orientation?: number }).orientation;
  if (typeof legacy === "number") return Math.abs(legacy) === 90;
  return window.innerWidth > window.innerHeight;
}

/** Snapshot of everything detection reads, from the live browser. */
export function readEnv(): DeviceEnv {
  const nav = navigator as Navigator & {
    userAgentData?: { platform?: string; mobile?: boolean };
    standalone?: boolean;
  };
  const modes: DisplayMode[] = [
    "fullscreen",
    "standalone",
    "minimal-ui",
    "window-controls-overlay",
  ];
  const display =
    modes.find((m) => mq(`(display-mode: ${m})`)) ?? (nav.standalone ? "standalone" : "browser");
  return {
    ua: nav.userAgent || "",
    uad: nav.userAgentData
      ? { platform: nav.userAgentData.platform, mobile: nav.userAgentData.mobile }
      : null,
    touchPoints: nav.maxTouchPoints || 0,
    screenW: window.screen?.width || window.innerWidth,
    screenH: window.screen?.height || window.innerHeight,
    innerW: window.innerWidth,
    innerH: window.innerHeight,
    coarse: mq("(pointer: coarse)"),
    anyFine: mq("(any-pointer: fine)"),
    display,
    posture: readPosture(),
    segs: readSegments(),
    landscape: readLandscape(),
  };
}

const WATCHED_QUERIES = [
  "(pointer: coarse)",
  "(any-pointer: fine)",
  "(display-mode: standalone)",
  "(display-mode: fullscreen)",
  "(device-posture: folded)",
  "(horizontal-viewport-segments: 2)",
  "(vertical-viewport-segments: 2)",
];

/** Calls `onChange` with a fresh profile whenever size, posture, segments, input or display mode change.
 *  Returns an unsubscribe function. Updates are coalesced to one per animation frame. */
export function watchDeviceProfile(onChange: (p: DeviceProfile) => void): () => void {
  let raf = 0;
  const run = () => {
    raf = 0;
    onChange(detectProfile(readEnv()));
  };
  const schedule = () => {
    if (!raf) raf = requestAnimationFrame(run);
  };
  window.addEventListener("resize", schedule);
  window.addEventListener("orientationchange", schedule);
  window.visualViewport?.addEventListener("resize", schedule);
  const lists = WATCHED_QUERIES.map((q) => {
    try {
      const m = window.matchMedia(q);
      m.addEventListener("change", schedule);
      return m;
    } catch {
      return null;
    }
  });
  const dp = (navigator as unknown as { devicePosture?: EventTarget }).devicePosture;
  dp?.addEventListener?.("change", schedule);
  return () => {
    if (raf) cancelAnimationFrame(raf);
    window.removeEventListener("resize", schedule);
    window.removeEventListener("orientationchange", schedule);
    window.visualViewport?.removeEventListener("resize", schedule);
    lists.forEach((m) => m?.removeEventListener("change", schedule));
    dp?.removeEventListener?.("change", schedule);
  };
}
