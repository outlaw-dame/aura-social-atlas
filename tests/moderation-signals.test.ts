import { beforeEach, describe, expect, test } from 'bun:test';
import { accountCandidates, acctKey, clearSignals, recordSignal, resetSignals } from '../src/lib/moderation-signals';

// Invented accounts; localStorage is a stand-in.
const store = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };
beforeEach(() => { store.clear(); resetSignals(); });
const me = 'atlas-user-1';

describe('moderation signals', () => {
  test('handles become name@host; Fedizen accounts get its host; anything else is refused', () => {
    expect(acctKey('@Spam@Example.social')).toBe('spam@example.social');
    expect(acctKey('localname')).toBe('localname@fedizen.net');
    expect(acctKey('not a handle')).toBeNull();
    expect(acctKey('')).toBeNull();
  });

  test('an account needs two caught posts, two boosts or replies of blocked people, or a report', () => {
    recordSignal(me, 'caught', 'once@a.example', 'p1', 'f1');
    recordSignal(me, 'caught', 'twice@a.example', 'p2', 'f1');
    recordSignal(me, 'caught', 'twice@a.example', 'p3', 'f2');
    recordSignal(me, 'caught', 'twice@a.example', 'p3', 'f2'); // the same post again counts once
    recordSignal(me, 'boosts-blocked', 'booster@b.example', 'p4');
    recordSignal(me, 'replies-blocked', 'booster@b.example', 'p5');
    recordSignal(me, 'reported', 'reported@c.example', 'report:1');
    const got = accountCandidates(me, new Set());
    expect(got.map(a => a.acct).sort()).toEqual(['booster@b.example', 'reported@c.example', 'twice@a.example']);
    expect(got.find(a => a.acct === 'twice@a.example')).toMatchObject({ caught: 2, filters: ['f1', 'f2'] });
    expect(got.find(a => a.acct === 'booster@b.example')).toMatchObject({ boostsBlocked: 1, repliesBlocked: 1 });
  });

  test('already blocked or muted accounts are left out; old events expire after 30 days', () => {
    const old = Date.now() - 31 * 86_400_000;
    recordSignal(me, 'reported', 'gone@d.example', 'r1', undefined, old);
    recordSignal(me, 'reported', 'blocked@d.example', 'r2');
    expect(accountCandidates(me, new Set(['blocked@d.example']))).toEqual([]);
  });

  test('kept per Atlas account, and forgotten on request', () => {
    recordSignal(me, 'reported', 'x@e.example', 'r1');
    expect(accountCandidates('someone-else', new Set())).toEqual([]);
    clearSignals(me);
    expect(accountCandidates(me, new Set())).toEqual([]);
  });
});
