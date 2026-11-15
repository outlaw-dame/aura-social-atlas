import { f7 } from 'framework7-react';

/**
 * Phone navigation for pages that belong in a stack rather than a sheet: a hashtag's feed is pushed like any feed — a
 * back chevron at the top left, swipe from the left edge to go back, the tab bar staying put.
 *
 * Framework7 9 keeps only one page behind the current one and rebuilds older ones from their routes, but the main
 * view's root page (all the tabs) is inline and has no route to rebuild from. So pushed pages live in their own view
 * (.atlas-stack) laid over the main one, whose root is an empty, transparent page: going back to it reveals the feed
 * exactly as it was, scroll position and all.
 */
const STACK = '.atlas-stack';
const stackRouter = () => f7?.views?.get(STACK)?.router;

function syncStackState() {
  const router = stackRouter();
  const deep = !!router && router.history.length > 1;
  document.documentElement.classList.toggle('atlas-stack-open', deep);
  // The left edge belongs to whichever is in front: back on a pushed page, the side panel on the root.
  const panel = f7.panel.get('.atlas-panel');
  if (panel) { if (deep) panel.disableSwipe(); else panel.enableSwipe(); }
}

export function pushPage(url: string, props?: Record<string, unknown>) {
  const router = stackRouter();
  if (!router) return;
  // A tag tapped inside a sheet (a group, a profile, a collection) closes the sheet so the page lands in front.
  document.querySelectorAll('.popup.modal-in').forEach(el => f7.popup.close(el as HTMLElement));
  document.documentElement.classList.add('atlas-stack-open');
  router.navigate(url, { props });
}

/** Back to the root, as tapping a tab does in a stack-based app. */
export function popToRoot() {
  const router = stackRouter();
  if (!router || router.history.length < 2) return;
  router.back(router.history[0], { force: true, animate: false });
}

/** Keeps the html class and the panel's edge swipe in step with the stack. Returns a cleanup. */
export function bindStack() {
  const router = stackRouter();
  if (!router) return () => {};
  router.on('routeChanged', syncStackState);
  router.on('swipebackMove', () => document.documentElement.classList.add('atlas-stack-open'));
  syncStackState();
  return () => router.off('routeChanged', syncStackState);
}

/** Every way of choosing a destination (tab bar, rail, sidebar, Settings) goes through here, so a pushed page never
 *  stays in front of the tab that was chosen. */
export function showTab(id: string) {
  popToRoot();
  f7.tab.show(`#${id}`);
}

export const tagPageUrl = (tag: string) => `/tag/${encodeURIComponent(tag.toLowerCase())}/`;
