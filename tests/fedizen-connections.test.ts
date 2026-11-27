import { afterEach, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { _resetFedizenConnections, connectionStats, fedizenFetch, fedizenFetchOptions, OLD_POOL_GRACE_MS, renewFedizenConnections, RENEW_GAP_MS, timedOutConnecting } from '../src/lib/fedizen-connections';

const SYM = Symbol.for('undici.globalDispatcher.1');
const made: { opts: Record<string, unknown>; closed: number; destroyed: number }[] = [];
class FakePool {
  rec: { opts: Record<string, unknown>; closed: number; destroyed: number };
  constructor(opts: Record<string, unknown>) { this.rec = { opts, closed: 0, destroyed: 0 }; made.push(this.rec); }
  async close() { this.rec.closed++; }
  async destroy() { this.rec.destroyed++; }
}
const g = globalThis as unknown as Record<symbol, unknown>;
const realFetch = globalThis.fetch;
afterEach(() => { delete g[SYM]; _resetFedizenConnections(); made.length = 0; globalThis.fetch = realFetch; });

describe("Atlas's own connections to Fedizen", () => {
  test('without Node’s pool (Bun, Cloudflare): the runtime’s fetch, unchanged', () => {
    expect(fedizenFetchOptions()).toEqual({});
    expect(renewFedizenConnections()).toBe(false);
  });

  test('a pool of its own: idle connections kept briefly, connecting limited to 5 s', () => {
    g[SYM] = new FakePool({});
    made.length = 0;
    const o = fedizenFetchOptions() as { dispatcher?: FakePool };
    expect(o.dispatcher).toBeInstanceOf(FakePool);
    expect(made[0]!.opts).toEqual({ keepAliveTimeout: 4000, keepAliveMaxTimeout: 15000, connect: { timeout: 5000 } });
    expect(fedizenFetchOptions().dispatcher).toBe(o.dispatcher);
  });

  test('after a timeout: a fresh pool; the old one closed, then destroyed; not again moments later', () => {
    g[SYM] = new FakePool({});
    made.length = 0;
    const first = fedizenFetchOptions().dispatcher;
    expect(renewFedizenConnections(1_000_000)).toBe(true);
    expect(fedizenFetchOptions().dispatcher).not.toBe(first);
    expect(made[0]!.closed).toBe(1);
    expect(renewFedizenConnections(1_000_000 + RENEW_GAP_MS - 1)).toBe(false);
    expect(renewFedizenConnections(1_000_000 + RENEW_GAP_MS)).toBe(true);
    expect(connectionStats().renewals).toBe(2);
    expect(OLD_POOL_GRACE_MS).toBe(30_000);
  });

  test('fedizenFetch renews on a timeout, not on an abort or a refusal', async () => {
    g[SYM] = new FakePool({});
    const timeout = Object.assign(new Error('t'), { name: 'TimeoutError' });
    globalThis.fetch = (async () => { throw timeout; }) as unknown as typeof fetch;
    await expect(fedizenFetch('https://fedizen.example/x')).rejects.toBe(timeout);
    expect(connectionStats().renewals).toBe(1);
    _resetFedizenConnections(new FakePool({}));
    globalThis.fetch = (async () => { throw Object.assign(new Error('a'), { name: 'AbortError' }); }) as unknown as typeof fetch;
    await expect(fedizenFetch('https://fedizen.example/x')).rejects.toThrow();
    expect(connectionStats().renewals).toBe(0);
    const connect = Object.assign(new Error('fetch failed'), { cause: Object.assign(new Error('c'), { code: 'UND_ERR_CONNECT_TIMEOUT' }) });
    expect(timedOutConnecting(connect)).toBe(true);
    expect(timedOutConnecting(timeout)).toBe(false);
  });

  test('every request to Fedizen goes through it', () => {
    const srv = readFileSync('src/lib/fedizen.server.ts', 'utf8');
    expect(srv).not.toMatch(/await fetch\(`\$\{FEDIZEN\}/);
    expect(srv).not.toMatch(/fetcher: typeof fetch = fetch\b/);
    expect(readFileSync('src/lib/live.server.ts', 'utf8')).not.toMatch(/await fetch\(/);
    expect(readFileSync('src/lib/groups.server.ts', 'utf8')).toMatch(/net\.fetch \?\? fedizenFetch/);
    expect(readFileSync('src/lib/bonfire-graphql.server.ts', 'utf8')).toMatch(/fetchImpl = fedizenFetch,/);
  });
});
