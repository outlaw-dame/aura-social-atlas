import { useSyncExternalStore } from 'react';
import type { FedizenPost } from './fedizen-feed';

/**
 * Asking the composer to open from elsewhere — a post's Boost menu → Quote — on desktop or phone, whichever composer
 * is mounted. Each request carries a number, so the same post can be quoted twice in a row.
 */
type Intent = { n: number; quote: FedizenPost } | null;
let current: Intent = null, n = 0;
const listeners = new Set<() => void>();

export function requestQuote(post: FedizenPost) {
  current = { n: ++n, quote: post };
  listeners.forEach(l => l());
}
export function useComposeIntent(): Intent {
  return useSyncExternalStore(l => { listeners.add(l); return () => { listeners.delete(l); }; }, () => current, () => null);
}
