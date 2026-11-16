import { afterEach, describe, expect, test } from 'bun:test';
import { downloadGif, isKlipyMedia, listGifs, pickFile, toGif } from '../src/lib/klipy.server';

const fmt = (url: string, width = 200, height = 150, size?: number) => ({ url, width, height, ...(size ? { size } : {}) });
const item = (slug: string, extra: Record<string, unknown> = {}) => ({
  id: 1, slug, title: ` ${slug} dance `, type: 'gif',
  file: {
    hd: { gif: fmt(`https://static.klipy.com/${slug}/hd.gif`, 498, 374, 9_000_000) },
    md: { gif: fmt(`https://static.klipy.com/${slug}/md.gif`, 320, 240, 2_000_000), webp: fmt(`https://static.klipy.com/${slug}/md.webp`) },
    sm: { gif: fmt(`https://static.klipy.com/${slug}/sm.gif`, 220, 165, 600_000), webp: fmt(`https://static.klipy.com/${slug}/sm.webp`, 220, 165) },
    xs: { gif: fmt(`https://static.klipy.com/${slug}/xs.gif`, 90, 68, 100_000) },
  },
  ...extra,
});

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; delete process.env['KLIPY_API_KEY']; });

describe('KLIPY GIFs (lib/klipy.server)', () => {
  test('media URLs: https on a public host only', () => {
    expect(isKlipyMedia('https://static.klipy.com/a.gif')).toBe(true);
    for (const bad of ['http://static.klipy.com/a.gif', 'https://127.0.0.1/a.gif', 'https://localhost/a.gif', 'https://u:p@klipy.com/a.gif', 'https://[::1]/a.gif', 'https://metadata.google.internal/x', 'nope'])
      expect(isKlipyMedia(bad)).toBe(false);
  });
  test('a tile is the small WebP, titled; ads and broken items are dropped', () => {
    expect(toGif(item('cat'))).toEqual({ slug: 'cat', title: 'cat dance', preview: { url: 'https://static.klipy.com/cat/sm.webp', width: 220, height: 165 } });
    expect(toGif(item('ad1', { type: 'ad' }))).toBeNull();
    expect(toGif({ slug: '../x', file: {} })).toBeNull();
    expect(toGif(item('nofile', { file: {} }))).toBeNull();
  });
  test('the posted file is the largest GIF known to fit Fedizen’s image limit', () => {
    expect(pickFile(item('cat'), 5_000_000)?.url).toBe('https://static.klipy.com/cat/md.gif');
    expect(pickFile(item('cat'), 10_000_000)?.url).toBe('https://static.klipy.com/cat/hd.gif');
    expect(pickFile(item('cat'), 50_000)).toBeNull();
  });
  test('no key: not configured, and KLIPY is never called', async () => {
    let called = false;
    globalThis.fetch = (async () => { called = true; return new Response('{}'); }) as unknown as typeof fetch;
    await expect(listGifs('cat', 1)).rejects.toMatchObject({ reason: 'not-configured' });
    expect(called).toBe(false);
  });
  test('search: key in the path, moderate rating, ads skipped, duplicates once', async () => {
    process.env['KLIPY_API_KEY'] = 'k/ey';
    let url = '';
    globalThis.fetch = (async (u: string) => {
      url = u;
      return new Response(JSON.stringify({ result: true, data: { data: [item('a'), item('ad', { type: 'ad' }), item('a'), item('b')], current_page: 1, per_page: 24, has_next: true } }));
    }) as unknown as typeof fetch;
    const r = await listGifs('happy cat', 2, 'en_US');
    const u = new URL(url);
    expect(u.origin + u.pathname).toBe('https://api.klipy.com/api/v1/k%2Fey/gifs/search');
    expect(Object.fromEntries(u.searchParams)).toEqual({ page: '2', per_page: '24', rating: 'pg-13', q: 'happy cat', locale: 'en_US' });
    expect(r.gifs.map(g => g.slug)).toEqual(['a', 'b']);
    expect(r.hasNext).toBe(true);
  });
  test('trending when nothing is typed; a rate limit says busy', async () => {
    process.env['KLIPY_API_KEY'] = 'key';
    let url = '';
    globalThis.fetch = (async (u: string) => { url = u; return new Response('slow down', { status: 429 }); }) as unknown as typeof fetch;
    await expect(listGifs('', 1)).rejects.toMatchObject({ reason: 'busy' });
    expect(new URL(url).pathname).toBe('/api/v1/key/gifs/trending');
  });
  test('download: only a real GIF, within the limit', async () => {
    const gif = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 1, 2, 3]);
    globalThis.fetch = (async () => new Response(gif)) as unknown as typeof fetch;
    const b = await downloadGif('https://static.klipy.com/a.gif', 100);
    expect(b.type).toBe('image/gif');
    expect(b.size).toBe(gif.length);
    await expect(downloadGif('https://static.klipy.com/a.gif', 5)).rejects.toBeDefined();
    globalThis.fetch = (async () => new Response('<html>nope</html>')) as unknown as typeof fetch;
    await expect(downloadGif('https://static.klipy.com/a.gif', 100)).rejects.toBeDefined();
    await expect(downloadGif('http://static.klipy.com/a.gif', 100)).rejects.toBeDefined();
  });
});
