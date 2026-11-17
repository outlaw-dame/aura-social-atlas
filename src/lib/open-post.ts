import type { FedizenPost } from './fedizen-feed';

/**
 * Opening a post: its conversation in Atlas (thread.ts), as Mastodon, Bluesky and Phanpy open a post that's tapped —
 * not its page on Fedizen. On the phone the conversation is pushed onto the stack (AtlasMobileApp listens); on
 * desktop it's the /post/$id page. The post itself rides along, so the page draws it at once while the rest loads.
 */

export const OPEN_POST_EVENT = 'atlas:open-post';
export type OpenPostDetail = { statusId: string; seed?: FedizenPost };

export const isStatusId = (id: unknown): id is string => typeof id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(id);

export function openPost(p: Pick<FedizenPost, 'statusId'> & Partial<FedizenPost>): void {
  if (typeof window === 'undefined' || !isStatusId(p.statusId)) return;
  window.dispatchEvent(new CustomEvent<OpenPostDetail>(OPEN_POST_EVENT, { detail: { statusId: p.statusId, seed: 'paragraphs' in p ? p as FedizenPost : undefined } }));
}

/**
 * Whether a click on a post card is meant for the post itself: not for a link, button, field, media control or
 * folded section inside it, and not the end of selecting its text.
 */
export function isPostClick(e: { target: EventTarget | null; currentTarget?: EventTarget | null; defaultPrevented?: boolean; button?: number }): boolean {
  if (e.defaultPrevented || (e.button !== undefined && e.button !== 0)) return false;
  const t = e.target as Element | null;
  if (!t || typeof t.closest !== 'function') return false;
  // React carries events out of portals (a dialog, a sheet, a menu opened from the post): only clicks on the card itself.
  const card = e.currentTarget as Element | null;
  if (card && typeof card.contains === 'function' && !card.contains(t)) return false;
  if (t.closest('a, button, input, textarea, select, label, summary, video, audio, iframe, [role="button"], [role="menuitem"], [role="dialog"], [contenteditable="true"], .atlas-mfm-blur, .sheet-modal, .popup, .actions-modal, .dialog, [data-no-open]')) return false;
  const sel = typeof window !== 'undefined' ? window.getSelection?.() : null;
  return !(sel && !sel.isCollapsed && sel.toString().trim());
}

/** The posts last opened from a card, so the conversation page can draw the post before Fedizen answers. */
const seeds = new Map<string, FedizenPost>();
export function rememberSeed(p: FedizenPost): void {
  if (!isStatusId(p.statusId)) return;
  seeds.delete(p.statusId);
  seeds.set(p.statusId, p);
  if (seeds.size > 20) seeds.delete(seeds.keys().next().value!);
}
export const seedFor = (id: string): FedizenPost | undefined => seeds.get(id);
