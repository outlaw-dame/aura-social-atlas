/**
 * What the person's own moderation says about other accounts, for Intelligence's suggestions (Settings → Moderation →
 * Suggestions): who wrote posts their filters caught, who boosts or answers people they've blocked, and who they
 * reported. Counted in the browser as feeds are read (Fedizen doesn't filter for Atlas, and has no API listing a
 * person's reports), kept per Atlas account on this device for 30 days, and only ever sent to the person's own AI
 * provider when they ask for suggestions.
 */
export const SIGNAL_DAYS = 30;
/** Most blocked or muted handles, and noticed accounts, sent to the AI model at once. */
export const MAX_CONTEXT_HANDLES = 300;
export const MAX_NOTICED = 40;
const WINDOW = SIGNAL_DAYS * 86_400_000;
const MAX_EVENTS = 3000;
const LOCAL_HOST = 'fedizen.net';
const key = (account: string) => `atlas.moderation-signals.${account}`;

export type SignalKind = 'caught' | 'boosts-blocked' | 'replies-blocked' | 'reported';
/** One thing seen: an account, what it did, when, and (for caught posts) the filter; `ref` keeps it counted once. */
type Event = { k: SignalKind; a: string; t: number; ref: string; f?: string };

/** name@host, lower case, without a leading @; Fedizen's own accounts come without a host. Null when it isn't one. */
export function acctKey(handle: string | undefined | null): string | null {
  const h = (handle ?? '').trim().replace(/^@/, '').toLowerCase();
  if (!/^[a-z0-9_.-]+(@[a-z0-9.-]+\.[a-z]{2,})?$/.test(h)) return null;
  return h.includes('@') ? h : `${h}@${LOCAL_HOST}`;
}

let scope: string | null = null;
let events: Event[] = [];
let seen = new Set<string>();
let saving: ReturnType<typeof setTimeout> | null = null;

function load(account: string) {
  scope = account;
  try { const raw = localStorage.getItem(key(account)); events = raw ? (JSON.parse(raw) as Event[]) : []; } catch { events = []; }
  if (!Array.isArray(events)) events = [];
  const now = Date.now();
  events = events.filter(e => e && typeof e.a === 'string' && typeof e.t === 'number' && now - e.t < WINDOW).slice(-MAX_EVENTS);
  seen = new Set(events.map(e => `${e.k}\n${e.a}\n${e.ref}`));
}
function save() {
  if (saving) return;
  saving = setTimeout(() => {
    saving = null;
    try { if (scope) localStorage.setItem(key(scope), JSON.stringify(events)); } catch { /* full or private: kept this session only */ }
  }, 1000);
}

/** Notes one thing an account did, once per `ref` (a post, or a report). */
export function recordSignal(account: string, kind: SignalKind, handle: string | undefined | null, ref: string, filterId?: string, now = Date.now()) {
  const a = acctKey(handle);
  if (!a || !ref) return;
  if (scope !== account) load(account);
  const id = `${kind}\n${a}\n${ref}`;
  if (seen.has(id)) return;
  seen.add(id);
  events.push({ k: kind, a, t: now, ref, ...(filterId ? { f: filterId } : {}) });
  if (events.length > MAX_EVENTS) { const gone = events.splice(0, events.length - MAX_EVENTS); for (const e of gone) seen.delete(`${e.k}\n${e.a}\n${e.ref}`); }
  save();
}

/** What one account did, for the AI model to weigh: counts only, and which filters caught it. */
export type AccountSignals = { acct: string; caught: number; filters: string[]; boostsBlocked: number; repliesBlocked: number; reported: boolean };

/**
 * Accounts worth a look, strongest first: caught by filters at least twice, boosting or answering blocked people at
 * least twice, or reported. Accounts in `skip` (already blocked or muted) are left out. At most `limit`.
 */
export function accountCandidates(account: string, skip: ReadonlySet<string>, limit = MAX_NOTICED, now = Date.now()): AccountSignals[] {
  if (scope !== account) load(account);
  const by = new Map<string, AccountSignals>();
  for (const e of events) {
    if (now - e.t >= WINDOW || skip.has(e.a)) continue;
    const s = by.get(e.a) ?? { acct: e.a, caught: 0, filters: [], boostsBlocked: 0, repliesBlocked: 0, reported: false };
    if (e.k === 'caught') { s.caught++; if (e.f && !s.filters.includes(e.f)) s.filters.push(e.f); }
    else if (e.k === 'boosts-blocked') s.boostsBlocked++;
    else if (e.k === 'replies-blocked') s.repliesBlocked++;
    else s.reported = true;
    by.set(e.a, s);
  }
  const weight = (s: AccountSignals) => s.caught + 2 * (s.boostsBlocked + s.repliesBlocked) + (s.reported ? 5 : 0);
  return [...by.values()]
    .filter(s => s.caught >= 2 || s.boostsBlocked + s.repliesBlocked >= 2 || s.reported)
    .sort((x, y) => weight(y) - weight(x))
    .slice(0, limit);
}

/** Forget everything noted for this account on this device (signing out, or from Settings). */
export function clearSignals(account: string) {
  try { localStorage.removeItem(key(account)); } catch { /* nothing kept */ }
  if (scope === account) { events = []; seen = new Set(); }
}

/** For tests: start from nothing. */
export function resetSignals() { scope = null; events = []; seen = new Set(); if (saving) clearTimeout(saving); saving = null; }
