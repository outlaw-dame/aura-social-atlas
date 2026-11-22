/**
 * AVIF is Baseline across current browsers, but an older Safari (before 16.4) can fail to decode it. Rather than wrap
 * every bundled image in <picture>, one capture-phase listener swaps a registered AVIF for its fallback (WebP or the
 * original JPEG) when it fails. Server-rendered images can fail before this runs (slow script, no AVIF): their error
 * event has already fired and hydration won't retry an unchanged URL, so finished images with no picture are swept too.
 */
const FALLBACK = new Map<string, string>();
let installed = false;

const path = (u: string, base: string) => { try { return new URL(u, base).pathname; } catch { return u; } };

function swap(img: HTMLImageElement) {
  const next = FALLBACK.get(path(img.currentSrc || img.src, location.href));
  if (next && img.getAttribute('src') !== next) img.src = next;
}
function recoverFailed() {
  for (const img of Array.from(document.images)) if (img.complete && img.naturalWidth === 0) swap(img);
}

/** Register bundled AVIF → fallback pairs; installs the listener once, in the browser only. */
export function registerImageFallbacks(pairs: [avif: string, fallback: string][]) {
  for (const [avif, fallback] of pairs) FALLBACK.set(path(avif, 'http://x'), fallback);
  if (typeof window === 'undefined') return;
  if (!installed) {
    installed = true;
    window.addEventListener('error', e => { if (e.target instanceof HTMLImageElement) swap(e.target); }, true);
    if (document.readyState !== 'complete') window.addEventListener('load', recoverFailed, { once: true });
  }
  recoverFailed();
  // After hydration too, in case React re-applied the original src.
  window.setTimeout(recoverFailed, 0);
}
