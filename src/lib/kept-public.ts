/**
 * Public answers kept on this device (localStorage) so a page opens with them while the server is asked again,
 * eg. Discover's Voices to know, whose lookups go to dozens of other servers. Only public, non-personal data belongs
 * here. Versioned; anything unreadable or older than its age reads as nothing.
 */
const VERSION = 1;
const key = (name: string) => `atlas-public:${name}`;

export function readKeptPublic<T>(name: string, maxAgeMs: number, now = Date.now()): { data: T; savedAt: number } | null {
  try {
    const raw = localStorage.getItem(key(name));
    if (!raw) return null;
    const s = JSON.parse(raw) as { v: number; savedAt: number; data: T };
    if (s?.v !== VERSION || typeof s.savedAt !== 'number' || now - s.savedAt > maxAgeMs || now < s.savedAt || s.data == null) return null;
    return { data: s.data, savedAt: s.savedAt };
  } catch { return null; }
}

export function writeKeptPublic<T>(name: string, data: T, maxBytes = 200_000, now = Date.now()) {
  try {
    const raw = JSON.stringify({ v: VERSION, savedAt: now, data });
    if (raw.length <= maxBytes) localStorage.setItem(key(name), raw);
  } catch { /* storage full or unavailable */ }
}
