/**
 * Whether this device shows the switch to compare Atlas folds with Phanpy's and Bonfire's (folding.ts). Opening any
 * Atlas page with ?compare-folds=1 turns it on for this device, ?compare-folds=0 turns it off. Read when Atlas starts
 * (routes/__root.tsx) and when a conversation opens, so the flag counts whichever page it was added to.
 */
const KEY = 'atlas.dev.compareFolds';

export function compareFolds(search = typeof location === 'undefined' ? '' : location.search): boolean {
  try {
    const q = new URLSearchParams(search).get('compare-folds');
    if (q === '1') localStorage.setItem(KEY, '1');
    if (q === '0') localStorage.removeItem(KEY);
    return localStorage.getItem(KEY) === '1';
  } catch { return false; }
}
