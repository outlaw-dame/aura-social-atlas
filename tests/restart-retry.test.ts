import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { RESTARTING_STATUSES, RETRY_DELAYS_MS, retryWhileRestarting } from '../src/lib/restart-retry';

const answer = (status: number) => new Response(status === 200 ? '{"ok":true}' : '<h1>Bad gateway</h1>', { status });

/** A fetch that answers from `script` in order and records what it was asked. */
function scripted(script: Array<number | 'refused'>) {
  const calls: Array<string | undefined> = [];
  const fetchImpl = async (_input: RequestInfo | URL, init?: RequestInit) => {
    calls.push(init?.method);
    const next = script.shift();
    if (next === undefined) throw new Error('asked more often than scripted');
    if (next === 'refused') throw new TypeError('Failed to fetch');
    return answer(next);
  };
  return { fetchImpl, calls };
}

const waits: number[] = [];
const noWait = async (ms: number) => { waits.push(ms); };

describe('reads ride out a server restart', () => {
  test("the tunnel's 502 while the server boots: asked again after 1 s, then answered", async () => {
    waits.length = 0;
    const { fetchImpl, calls } = scripted([502, 200]);
    const r = await retryWhileRestarting(fetchImpl, RETRY_DELAYS_MS, noWait)('/_serverFn/x', { method: 'GET' });
    expect(r.status).toBe(200);
    expect(calls.length).toBe(2);
    expect(waits).toEqual([1000]);
  });

  test('503, 504 and a refused connection are retried too; two retries at most, 1 s then 2 s', async () => {
    waits.length = 0;
    const { fetchImpl, calls } = scripted(['refused', 503, 504]);
    const r = await retryWhileRestarting(fetchImpl, RETRY_DELAYS_MS, noWait)('/_serverFn/x');
    expect(r.status).toBe(504);
    expect(calls.length).toBe(3);
    expect(waits).toEqual([1000, 2000]);
    expect([...RESTARTING_STATUSES].sort()).toEqual([502, 503, 504]);
  });

  test('the last failure is what the caller gets when the server stays down', async () => {
    const { fetchImpl } = scripted(['refused', 'refused', 'refused']);
    await expect(retryWhileRestarting(fetchImpl, RETRY_DELAYS_MS, noWait)('/_serverFn/x', { method: 'HEAD' })).rejects.toThrow('Failed to fetch');
  });

  test("other answers are the server's own and come back at once", async () => {
    for (const status of [200, 400, 401, 404, 429, 500]) {
      const { fetchImpl, calls } = scripted([status]);
      expect((await retryWhileRestarting(fetchImpl, RETRY_DELAYS_MS, noWait)('/_serverFn/x')).status).toBe(status);
      expect(calls.length).toBe(1);
    }
  });

  test('writes are sent once: a 502 may come after the server took the request', async () => {
    for (const method of ['POST', 'post', 'PUT', 'DELETE', 'PATCH']) {
      const { fetchImpl, calls } = scripted([502]);
      expect((await retryWhileRestarting(fetchImpl, RETRY_DELAYS_MS, noWait)('/_serverFn/x', { method })).status).toBe(502);
      expect(calls.length).toBe(1);
    }
    const { fetchImpl, calls } = scripted([502]);
    await retryWhileRestarting(fetchImpl, RETRY_DELAYS_MS, noWait)(new Request('https://atlas.test/_serverFn/x', { method: 'POST', body: '{}' }));
    expect(calls.length).toBe(1);
  });

  test('a request the page cancelled is not asked again, and a cancel during the wait stops it', async () => {
    const gone = new AbortController();
    gone.abort();
    const refused = scripted(['refused', 200]);
    await expect(retryWhileRestarting(refused.fetchImpl, RETRY_DELAYS_MS, noWait)('/_serverFn/x', { signal: gone.signal })).rejects.toThrow();
    expect(refused.calls.length).toBe(1);

    const later = new AbortController();
    const { fetchImpl, calls } = scripted([502, 200]);
    const pending = retryWhileRestarting(fetchImpl, [60_000])('/_serverFn/x', { signal: later.signal });
    await new Promise(r => setTimeout(r, 5));
    later.abort(new DOMException('left the page', 'AbortError'));
    await expect(pending).rejects.toThrow('left the page');
    expect(calls.length).toBe(1);
  });

  test('every server-function call in the browser goes through it', () => {
    expect(readFileSync('src/start.ts', 'utf8')).toMatch(/serverFns: \{ fetch: retryWhileRestarting\(\(input, init\) => fetch\(input, init\)\) \}/);
  });
});

describe('the phone app navigates through a restart', () => {
  const sw = readFileSync('public/sw.js', 'utf8');
  // The service worker's own retry, run on its own: from its constants to the end of navigationResponse.
  const start = sw.indexOf('const RESTARTING_STATUSES');
  const end = sw.indexOf('async function navigation(event)');
  const source = sw.slice(start, end).replace('const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));', '');
  const make = new Function('fetch', 'pause', `${source}; return { navigationResponse, RETRY_DELAYS_MS };`) as (
    f: (r: unknown) => Promise<Response>, p: (ms: number) => Promise<void>,
  ) => { navigationResponse: (e: { request: unknown; preloadResponse: Promise<Response | undefined> }) => Promise<Response>; RETRY_DELAYS_MS: number[] };

  test('a 502 from the preload is asked again fresh, with the same waits as reads', async () => {
    const asked: number[] = [];
    const script = [503, 200];
    const sws = make(async () => answer(script.shift()!), async ms => { asked.push(ms); });
    const r = await sws.navigationResponse({ request: {}, preloadResponse: Promise.resolve(answer(502)) });
    expect(r.status).toBe(200);
    expect(asked).toEqual([1000, 2000]);
    expect(sws.RETRY_DELAYS_MS).toEqual([...RETRY_DELAYS_MS]);
  });

  test('without a preload, a refused connection is retried; a 404 is not', async () => {
    const script: Array<number | 'refused'> = ['refused', 404];
    const sws = make(async () => { const n = script.shift(); if (n === 'refused') throw new TypeError('Failed to fetch'); return answer(n!); }, async () => {});
    expect((await sws.navigationResponse({ request: {}, preloadResponse: Promise.resolve(undefined) })).status).toBe(404);
    expect(script.length).toBe(0);
  });

  test('the saved shell still shows when the server is slow or answers an error', () => {
    expect(sw).toMatch(/const NAV_TIMEOUT_MS = 2000;/);
    expect(sw).toMatch(/return first && first\.ok \? first : kept;/);
    expect(sw).toMatch(/const network = navigationResponse\(event\)\.then/);
  });
});
