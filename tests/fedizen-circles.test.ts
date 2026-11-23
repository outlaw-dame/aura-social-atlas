import { afterEach, describe, expect, mock, test } from 'bun:test';
import { circleReach, circleSchema, followersAmong, savedAudiences } from '../src/lib/fedizen-circles';
import { CREATE_CIRCLE_DOCUMENT, MY_CIRCLES_DOCUMENT, POST_AUDIENCES_DOCUMENT, UPDATE_CIRCLE_DOCUMENT } from '../src/lib/bonfire/graphql/operations';
import { readMyAudiences, readMyCircles, saveCircle } from '../src/lib/fedizen-circles.server';
import { resetRateLimitState } from '../src/lib/fedizen-rate-limit';

const answer = (data: unknown) => new Response(JSON.stringify({ data }), { status: 200, headers: { 'content-type': 'application/json' } });

describe('who a circle post reaches (only members who follow you, on Fedizen)', () => {
  test('followers among the members come from relationships followed_by, and only for the ids asked about', () => {
    const rel = [{ id: 'A', followed_by: true }, { id: 'B', followed_by: false }, { id: 'C', followed_by: null }, { id: 'X', followed_by: true }];
    expect(followersAmong(rel, ['A', 'B', 'C'])).toEqual(['A']);
    expect(followersAmong('nonsense', ['A'])).toEqual([]);
  });
  test('the circle page says plainly what a circle post reaches', () => {
    expect(circleReach(0, 0)).toBeNull();
    expect(circleReach(4, null)).toBe('Fedizen sends circle posts only to members who follow you.');
    expect(circleReach(4, 4)).toBe('All 4 follow you, so your circle posts reach everyone here.');
    expect(circleReach(4, 0)).toContain('None of them follow you');
    expect(circleReach(4, 2)).toBe('2 of 4 follow you. Fedizen sends circle posts only to members who follow you.');
    expect(circleReach(1, 1)).toBe('They follow you, so your circle posts reach them.');
  });
});

describe('circle descriptions through GraphQL', () => {
  test('the documents ask for names and descriptions, leaving out built-in circles', () => {
    expect(MY_CIRCLES_DOCUMENT).toContain('excludeStereotypes: true, excludeBuiltIns: true');
    for (const d of [MY_CIRCLES_DOCUMENT, CREATE_CIRCLE_DOCUMENT, UPDATE_CIRCLE_DOCUMENT]) expect(d).toContain('id name summary');
  });
  test('a circle is read with a fallback name and a trimmed, bounded description', () => {
    expect(circleSchema.parse({ id: '01A', name: '  Family ', summary: ' Close ones ' })).toEqual({ id: '01A', title: 'Family', summary: 'Close ones' });
    expect(circleSchema.parse({ id: '01A', name: '', summary: null })).toEqual({ id: '01A', title: 'Untitled circle' });
    expect(circleSchema.parse({ id: '01A', name: 'x', summary: 'y'.repeat(900) }).summary).toHaveLength(500);
    expect(circleSchema.safeParse({ id: '../x', name: 'x' }).success).toBe(false);
  });

  const realFetch = globalThis.fetch;
  afterEach(() => { globalThis.fetch = realFetch; resetRateLimitState(); });

  test('renaming always sends the description too (Bonfire replaces it with whatever it gets)', async () => {
    let sent: { variables?: { id?: string; circle?: unknown } } = {};
    globalThis.fetch = mock(async (_u: unknown, init?: RequestInit) => {
      sent = JSON.parse(String(init?.body));
      return answer({ updateCircle: { id: '01A', name: 'Apple', summary: 'Mac news' } });
    }) as unknown as typeof fetch;
    const saved = await saveCircle('t', { id: '01A', title: 'Apple', summary: 'Mac news' });
    expect(sent.variables).toEqual({ id: '01A', circle: { name: 'Apple', summary: 'Mac news' } });
    expect(saved).toEqual({ id: '01A', title: 'Apple', summary: 'Mac news' });
  });

  test('an answer about another circle is not trusted', async () => {
    globalThis.fetch = mock(async () => answer({ updateCircle: { id: '01OTHER', name: 'x', summary: null } })) as unknown as typeof fetch;
    await expect(saveCircle('t', { id: '01A', title: 'x', summary: '' })).rejects.toThrow();
  });

  test('circles that don\'t fit are dropped, not the whole list', async () => {
    globalThis.fetch = mock(async () => answer({ myCircles: [{ id: '01A', name: 'Apple', summary: null }, { id: 'bad id!', name: 'x' }] })) as unknown as typeof fetch;
    expect(await readMyCircles('t')).toEqual([{ id: '01A', title: 'Apple' }]);
  });
});

describe("Fedizen's saved audiences", () => {
  test('only the person\'s own named audiences are offered (presets are Atlas\'s own audiences)', () => {
    const options = [
      { id: 'public', label: 'Public', custom: false },
      { id: '01ACL', label: ' Hill walkers ', description: 'Saturday walks', custom: true },
      { id: '01ACL', label: 'Duplicate', custom: true },
      { id: '01NONAME', label: '  ', custom: true },
      { id: 'bad/id', label: 'Bad', custom: true },
    ];
    expect(savedAudiences(options)).toEqual([{ id: '01ACL', label: 'Hill walkers', description: 'Saturday walks' }]);
    expect(savedAudiences(null)).toEqual([]);
  });
  test('they are read from boundaries.options', async () => {
    expect(POST_AUDIENCES_DOCUMENT).toContain('boundaries { options { id label description custom } }');
    const realFetch = globalThis.fetch;
    globalThis.fetch = mock(async () => answer({ boundaries: { options: [{ id: '01ACL', label: 'Walkers', custom: true }] } })) as unknown as typeof fetch;
    try { expect(await readMyAudiences('t')).toEqual([{ id: '01ACL', label: 'Walkers' }]); }
    finally { globalThis.fetch = realFetch; resetRateLimitState(); }
  });
  test('posting to one checks it is yours first, and never offers quoting', async () => {
    const src = await Bun.file('src/lib/fedizen.functions.ts').text();
    expect(src).toContain("if (!mine.some(a => a.id === data.audienceId)) return { ok: false, error: 'no-audience' };");
    expect(src).toContain("const quotes = data.visibility === 'saved' ? 'nobody' as const : data.quotes;");
  });
});
