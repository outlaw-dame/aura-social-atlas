/**
 * "View" after posting: the new post in Atlas's own feed, not on Fedizen's site. Feed cards carry
 * `data-status-id`; this waits for the post to arrive (the feed refetches after a post), scrolls to it and marks
 * it briefly. False if it didn't show up in time (another feed tab may be open).
 */
export async function revealPost(id: string, timeoutMs = 8000): Promise<boolean> {
  if (typeof document === 'undefined' || !/^[A-Za-z0-9_-]{1,64}$/.test(id)) return false;
  const started = Date.now();
  for (;;) {
    const el = document.querySelector<HTMLElement>(`[data-status-id="${id}"]`);
    if (el) {
      const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      el.scrollIntoView({ block: 'center', behavior: reduce ? 'auto' : 'smooth' });
      if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '-1');
      el.focus({ preventScroll: true });
      el.classList.add('atlas-post-flash');
      setTimeout(() => el.classList.remove('atlas-post-flash'), 2400);
      return true;
    }
    if (Date.now() - started > timeoutMs) return false;
    await new Promise(r => setTimeout(r, 250));
  }
}
