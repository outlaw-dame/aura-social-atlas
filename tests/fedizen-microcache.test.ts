import { beforeEach, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { MICRO_MS, _resetMicrocache, forgetMicrocache, microcached, reuseFor } from '../src/lib/fedizen-microcache';

beforeEach(() => _resetMicrocache());
const answer = (n: number) => ({ status: 200, data: [{ n }] });

describe('micro-caching Fedizen reads', () => {
  test('identical reads in flight go to Fedizen once; each caller gets its own copy', async () => {
    let calls = 0;
    let release!: () => void;
    const gate = new Promise<void>(r => { release = r; });
    const read = async () => { calls++; await gate; return answer(1); };
    const a = microcached('acct', '/api/v1/timelines/home?limit=20', MICRO_MS, read);
    const b = microcached('acct', '/api/v1/timelines/home?limit=20', MICRO_MS, read);
    release();
    const [x, y] = await Promise.all([a, b]);
    expect(calls).toBe(1);
    expect(x).toEqual(y);
    (x.data[0] as { n: number }).n = 99;
    expect((y.data[0] as { n: number }).n).toBe(1);
  });

  test('a 200 is reused for a few seconds, then read again', async () => {
    let t = 1000, calls = 0;
    const read = async () => answer(++calls);
    await microcached('acct', '/p', MICRO_MS, read, () => t);
    t += MICRO_MS - 1;
    expect((await microcached('acct', '/p', MICRO_MS, read, () => t)).data).toEqual([{ n: 1 }]);
    t += 2;
    expect((await microcached('acct', '/p', MICRO_MS, read, () => t)).data).toEqual([{ n: 2 }]);
  });

  test('never shared between accounts, paths or options', async () => {
    let calls = 0;
    const read = async () => answer(++calls);
    await microcached('a', '/p', MICRO_MS, read);
    await microcached('b', '/p', MICRO_MS, read);
    await microcached('a', '/q', MICRO_MS, read);
    await microcached('a', 'strict /p', MICRO_MS, read);
    expect(calls).toBe(4);
  });

  test('errors are shared with whoever waited, never kept', async () => {
    let calls = 0;
    const read = async () => { calls++; return { status: 503, data: [] }; };
    await Promise.all([microcached('a', '/p', MICRO_MS, read), microcached('a', '/p', MICRO_MS, read)]);
    expect(calls).toBe(1);
    await microcached('a', '/p', MICRO_MS, read);
    expect(calls).toBe(2);
  });

  test("an account's write forgets its reads, including one still on its way", async () => {
    let calls = 0;
    let release!: () => void;
    const gate = new Promise<void>(r => { release = r; });
    const slow = async () => { calls++; await gate; return answer(calls); };
    const before = microcached('a', '/p', MICRO_MS, slow);
    forgetMicrocache('a');
    release();
    await before;
    await microcached('a', '/p', MICRO_MS, async () => answer(++calls));
    expect(calls).toBe(2);
    await microcached('b', '/p', MICRO_MS, async () => answer(++calls));
    forgetMicrocache('a');
    await microcached('b', '/p', MICRO_MS, async () => answer(++calls));
    expect(calls).toBe(3);
  });

  test('conversations are joined but not reused; instance settings are reused longer', () => {
    expect(reuseFor('/api/v1/statuses/abc/context')).toBe(0);
    expect(reuseFor('/api/v2/instance')).toBeGreaterThan(MICRO_MS);
    expect(reuseFor('/api/v1/timelines/home?limit=20')).toBe(MICRO_MS);
  });

  test('fedizenGet reads through it, and writes forget it', () => {
    const server = readFileSync('src/lib/fedizen.server.ts', 'utf8');
    expect(server).toMatch(/return microcached\(account, `\$\{opts\.requireCompleteModeration \? 'strict ' : ''\}\$\{path\}`, reuseFor\(path\)/);
    expect(readFileSync('src/lib/fedizen-rate-limit.ts', 'utf8')).toMatch(/forgetMicrocache\(account\);/);
  });
});
