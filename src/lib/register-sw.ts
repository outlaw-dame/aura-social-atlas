/** Registers the /app service worker (public/sw.js) — production only, secure contexts only,
 *  never inside an embedding frame. Failures are ignored: the app works without it. */
export function registerAppServiceWorker(): void {
  if (!import.meta.env.PROD) return;
  if (typeof window === "undefined" || !("serviceWorker" in navigator) || !window.isSecureContext)
    return;
  if (window.self !== window.top) return;
  navigator.serviceWorker
    .register("/sw.js", { scope: "/app" })
    .then(() => navigator.serviceWorker.ready)
    .then((reg) => {
      // Requests made before the worker took control (including the lazily loaded /app chunk)
      // never reached it: hand it the build assets this page loaded so the offline shell can render.
      const urls = performance
        .getEntriesByType("resource")
        .map((e) => e.name)
        .filter((u) => u.startsWith(`${location.origin}/assets/`));
      reg.active?.postMessage({ type: "atlas-precache", urls });
    })
    .catch(() => {});
}
