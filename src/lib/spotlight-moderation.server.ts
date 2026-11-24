/** Owner-only source of moderation for Spotlight. A partial block or mute list
 * can leak a denied actor, so pagination must either finish or fail closed.
 * Bonfire rc.1 may return all entries despite limit=80; paginated providers
 * must be supported without trusting Link headers as arbitrary request URLs.
 */
import type { SpotlightModeration } from './spotlight-curation';

type Reader = (path: string) => Promise<{ status: number; data: unknown[]; next?: string }>;
const PAGE_SIZE = 80;
const MAX_PAGES = 64;
const MAX_ENTRIES = 10_000;
const MAX_CURSOR = /^[A-Za-z0-9_\-.~=%]{1,512}$/;
const MAX_READ_MS = 12_000;

type Accounts = { handles: string[]; ids: string[] };

function parseAccounts(input: unknown): Accounts | null {
  if (!Array.isArray(input) || input.length > MAX_ENTRIES) return null;
  const handles: string[] = [], ids: string[] = [];
  for (const value of input) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const item = value as Record<string, unknown>;
    if (typeof item.id !== 'string' || !item.id || item.id.length > 64 ||
        typeof item.acct !== 'string' || !item.acct || item.acct.length > 320) return null;
    ids.push(item.id); handles.push(item.acct);
  }
  return { handles, ids };
}

/** Bounded traversal: no incomplete page, repeated/unsafe cursor, timeout or
 * oversized collection can be treated as a successfully empty policy.
 * The same fixed server-side OAuth grant is passed to every request.
 */
async function completeAccounts(
  read: Reader, route: 'blocks' | 'mutes', deadline: number,
): Promise<Accounts | null> {
  const accounts: Accounts = { handles: [], ids: [] };
  const seen = new Set<string>();
  let cursor: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    if (Date.now() >= deadline) return null;
    const path = `/api/v1/${route}?limit=${PAGE_SIZE}` +
      (cursor === undefined ? '' : `&max_id=${encodeURIComponent(cursor)}`);
    let result: Awaited<ReturnType<Reader>>;
    try { result = await read(path); } catch { return null; }
    if (Date.now() >= deadline || result.status !== 200) return null;
    const parsed = parseAccounts(result.data);
    if (!parsed || accounts.ids.length + parsed.ids.length > MAX_ENTRIES) return null;
    accounts.ids.push(...parsed.ids);
    accounts.handles.push(...parsed.handles);
    if (result.next === undefined) return accounts;
    if (!result.next || !MAX_CURSOR.test(result.next) || seen.has(result.next) ||
        !parsed.ids.length) return null;
    seen.add(result.next);
    cursor = result.next;
  }
  return null;
}

export async function readSpotlightModeration(read: Reader): Promise<SpotlightModeration | null> {
  const deadline = Date.now() + MAX_READ_MS;
  const [banned, muted] = await Promise.all([
    completeAccounts(read, 'blocks', deadline),
    completeAccounts(read, 'mutes', deadline),
  ]);
  if (!banned || !muted) return null;
  return {
    blockedHandles: banned.handles, blockedIds: banned.ids,
    mutedHandles: muted.handles, mutedIds: muted.ids,
    // No personal blocked-domain or Bonfire-native keyword snapshot exists in
    // deployed Fedizen's compatibility API. Remote actors stay withheld.
    domainCoverage: 'unavailable', blockedDomains: [],
  };
}
