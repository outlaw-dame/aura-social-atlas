import { describe, expect, test } from 'bun:test';

// fetch is stubbed; nothing is sent.
describe('older pages of each feed are allowed reads, and nothing else is', () => {
  const allowed = [
    '/api/v1/timelines/tag/astronomy?limit=20&max_id=g3QAAA%2Bx',
    '/api/v1/timelines/tag/astronomy?limit=10&max_id=g3QAAA',
    '/api/v1/timelines/list/01ABCDEF?limit=20&max_id=g3QAAA',
    '/api/v1/timelines/local?limit=20&max_id=g3QAAA',
    '/api/v1/timelines/local?limit=20',
  ];
  const refused = [
    '/api/v1/timelines/tag/astronomy?limit=20&max_id=a&local=true',
    '/api/v1/timelines/list/01ABCDEF?limit=40&max_id=a',
    '/api/v1/timelines/local?limit=20&max_id=a b',
    '/api/v1/timelines/local?limit=20&only_media=true',
  ];
  test.each(allowed)('%s', async path => {
    const { fedizenGet } = await import('../src/lib/fedizen.server');
    const real = globalThis.fetch;
    globalThis.fetch = (async () => new Response('[]', { headers: { link: '<https://fedizen.net/api/v1/timelines/local?max_id=NEXT>; rel="next"' } })) as unknown as typeof fetch;
    try { expect(await fedizenGet('t', path)).toEqual({ status: 200, data: [], next: 'NEXT' }); } finally { globalThis.fetch = real; }
  });
  test.each(refused)('refuses %s', async path => {
    const { fedizenGet } = await import('../src/lib/fedizen.server');
    await expect(fedizenGet('t', path)).rejects.toThrow('Unsupported Fedizen read path.');
  });
});
