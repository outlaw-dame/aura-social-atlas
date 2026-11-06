/** Registers the /app service worker (public/sw.js) — production only, secure contexts only,
 *  never inside an embedding frame. Failures are ignored: the app works without it. */
export function registerAppServiceWorker(): void {
  if (!import.meta.env.PROD) return;
  if (typeof window === "undefined" || !("serviceWorker" in navigator) || !window.isSecureContext)
    return;
  if (window.self !== window.top) return;
  navigator.serviceWorker.register("/sw.js", { scope: "/app" }).catch(() => {});
}
