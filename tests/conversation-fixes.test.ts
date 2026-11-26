import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { boostFields, fromStatuses, titleOf, withTitle } from '../src/lib/fedizen-feed';
import { HOLD_MAX_MS, holdForLimit, noteRateLimited, resetRateLimitState } from '../src/lib/fedizen-rate-limit';
import { _resetModerationCache, cachedModeration, forgetModeration, keepAuthor, keepRelation, knownAuthor, knownRelation } from '../src/lib/moderation-cache.server';

// Invented accounts and servers (.example, RFC 2606).
describe('titled posts (Lemmy, PieFed, articles)', () => {
  test("Bonfire's `name` shows first, in bold; a link post with no text isn't blank", () => {
    const [p] = fromStatuses([{ id: '1', content: '', name: 'Not a dirty bomb &amp; other news', account: { acct: 'op@lemmy.example' } }]);
    expect(p!.paragraphs).toEqual(['Not a dirty bomb & other news']);
    expect(p!.rich?.[0]).toEqual({ t: 'p', c: [{ t: 'b', c: [{ t: 'text', v: 'Not a dirty bomb & other news' }] }] });
  });
  test('the title before the text; not repeated when the text starts with it; nothing added without one', () => {
    expect(withTitle('Title', ['Body'], undefined)).toEqual({ paragraphs: ['Title', 'Body'], rich: [
      { t: 'p', c: [{ t: 'b', c: [{ t: 'text', v: 'Title' }] }] }, { t: 'p', c: [{ t: 'text', v: 'Body' }] }] });
    expect(withTitle('Title', ['Title', 'Body'], undefined)).toEqual({ paragraphs: ['Title', 'Body'] });
    expect(titleOf({ name: '  ' })).toBeUndefined();
    expect(titleOf({})).toBeUndefined();
    const [plain] = fromStatuses([{ id: '2', content: '<p>Hello</p>', account: { acct: 'a@b.example' } }]);
    expect(plain!.paragraphs).toEqual(['Hello']);
    expect(plain!.rich).toBeUndefined();
  });
  test('Fedizen reads keep `name`', () => {
    expect(readFileSync('src/lib/fedizen.server.ts', 'utf8')).toMatch(/name: z\.string\(\)\.max\(500\)\.nullish\(\)\.catch\(null\),\n  account: account\.nullish\(\),/);
  });
});

describe('relay boosts on every Home', () => {
  test('a FediBuzz relay is where a post came from, not a booster', () => {
    expect(boostFields({ name: 'Relay for bsky.brid.gy', acct: 'instance-bsky.brid.gy@relay.fedi.buzz' })).toEqual({ relayed: { kind: 'instance', value: 'bsky.brid.gy' } });
    expect(boostFields({ name: 'Ann', acct: 'ann@b.example' })).toEqual({ boostedBy: 'Ann', booster: { name: 'Ann', acct: 'ann@b.example' } });
    expect(boostFields(undefined, 'Ann')).toEqual({ boostedBy: 'Ann' });
  });
  test("Fedizen's own Home uses it too", () => {
    for (const f of ['src/lib/bonfire-private.server.ts', 'src/lib/bonfire-native-presentation.ts']) {
      const src = readFileSync(f, 'utf8');
      expect(src).toMatch(/boostFields\(/);
      expect(src).not.toMatch(/\{ boostedBy: \w+\.name, booster/);
    }
  });
});

describe("Fedizen's rate limit", () => {
  test('a short limit is waited out; a long one refuses at once', async () => {
    resetRateLimitState();
    noteRateLimited('a', '1');
    const t = Date.now();
    expect(await holdForLimit('a')).toBe(true);
    expect(Date.now() - t).toBeGreaterThanOrEqual(900);
    noteRateLimited('b', String(HOLD_MAX_MS / 1000 + 30));
    const t2 = Date.now();
    expect(await holdForLimit('b')).toBe(false);
    expect(Date.now() - t2).toBeLessThan(100);
    resetRateLimitState();
  });
  test('reads, writes and uploads all hold for it; a refusal says Fedizen asked Atlas to slow down', () => {
    const src = readFileSync('src/lib/fedizen.server.ts', 'utf8');
    expect(src.match(/holdForLimit\(account\)/g)?.length).toBe(3);
    expect(readFileSync('src/lib/fedizen.functions.ts', 'utf8')).toMatch(/status === 429 \? 'rate-limited'/);
  });
});

describe('moderation read once a while, not per conversation', () => {
  const snap = { blockedHandles: [], mutedHandles: [], blockedIds: [], mutedIds: [], domainCoverage: 'unavailable' as const, blockedDomains: [] };
  test('the lists: one read shared for 3 minutes; a failed read is asked again; forgotten after a block or mute', async () => {
    _resetModerationCache();
    let reads = 0;
    const read = async () => { reads++; return snap; };
    await cachedModeration('u', read, 0); await cachedModeration('u', read, 60_000);
    expect(reads).toBe(1);
    await cachedModeration('u', read, 3 * 60_000 + 1);
    expect(reads).toBe(2);
    forgetModeration('u');
    await cachedModeration('u', read, 3 * 60_000 + 2);
    expect(reads).toBe(3);
    let failing = 0;
    const bad = async () => { failing++; return null; };
    await cachedModeration('v', bad, 0); await new Promise(r => setTimeout(r, 0)); await cachedModeration('v', bad, 1);
    expect(failing).toBe(2);
  });
  test('authors kept 30 minutes (definite answers only); relationships 3 minutes, forgotten after a block', () => {
    _resetModerationCache();
    keepAuthor('u', 'x@y.example', { unknown: false }, 0);
    expect(knownAuthor('u', 'x@y.example', 1)).toBeUndefined();
    keepAuthor('u', 'x@y.example', { id: 'X1', unknown: false }, 0);
    expect(knownAuthor('u', 'x@y.example', 29 * 60_000)).toEqual({ id: 'X1', unknown: false });
    expect(knownAuthor('u', 'x@y.example', 31 * 60_000)).toBeUndefined();
    keepRelation('u', 'X1', { muting: true }, 0);
    expect(knownRelation('u', 'X1', 60_000)).toEqual({ blocking: undefined, muting: true, domain_blocking: undefined });
    forgetModeration('u');
    expect(knownRelation('u', 'X1', 60_000)).toBeUndefined();
  });
  test('Spotlight and replies from other servers share it; Atlas blocks and mutes forget it', () => {
    for (const f of ['src/lib/spotlight.functions.ts', 'src/lib/origin-replies.functions.ts']) expect(readFileSync(f, 'utf8')).toMatch(/cachedModeration\(/);
    expect(readFileSync('src/lib/fedizen.functions.ts', 'utf8').match(/forgetModeration\(context\.userId\)/g)?.length).toBe(2);
    expect(readFileSync('src/lib/fedizen-profile.functions.ts', 'utf8')).toMatch(/forgetModeration\(context\.userId\)/);
  });
});
