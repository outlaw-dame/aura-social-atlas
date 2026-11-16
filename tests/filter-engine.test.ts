import { describe, expect, test } from 'bun:test';
import { FilterEngine, type Judge } from '../src/lib/filter-engine';
import { filterKind, type ContentFilter, type FilterablePost } from '../src/lib/content-filter';

const f = (id: string, text: string, extra: Partial<ContentFilter> = {}): ContentFilter => ({ id, text, kind: filterKind(text), action: 'hide', semantic: true, expansions: [], places: ['home', 'public', 'account'], expiresAt: null, exceptFollowing: false, ...extra });
const post = (id: string, text: string, extra: Partial<FilterablePost> = {}): FilterablePost => ({ id, paragraphs: [text], visibility: 'public', ...extra });
const settle = () => new Promise(r => setTimeout(r, 200));

describe('filter engine', () => {
  test('without AI, words decide at once', () => {
    const e = new FilterEngine();
    e.configure({ filters: [f('a', 'shooting')], ai: false, deep: false });
    expect(e.evaluate(post('1', 'Photo shooting at dawn')).state).toBe('filtered');
    expect(e.evaluate(post('2', 'Sunrise')).state).toBe('clear');
  });

  test('with AI, a word match waits, then the model clears a false positive and confirms a real one', async () => {
    const calls: Parameters<Judge>[0][] = [];
    const judge: Judge = async posts => { calls.push(posts); return posts.map(p => ({ n: p.n, matches: /gun/.test(p.text) ? ['a'] : [] })); };
    const e = new FilterEngine();
    e.configure({ filters: [f('a', 'shooting')], ai: true, deep: false, judge });
    const photo = post('1', 'Photo shooting at dawn'), news = post('2', 'A shooting: gun violence downtown'), other = post('3', 'Sunrise');
    expect(e.evaluate(photo).state).toBe('pending');
    [photo, news, other].forEach(p => e.request(p));
    await settle();
    expect(calls.length).toBe(1);
    expect(calls[0].length).toBe(2); // the post with no match is never sent
    expect(e.evaluate(photo).state).toBe('clear');
    expect(e.evaluate(news)).toMatchObject({ state: 'filtered', action: 'hide' });
    expect(e.evaluate(other).state).toBe('clear');
  });

  test('deep matching sends other posts too but never holds them back', async () => {
    const judge: Judge = async posts => posts.map(p => ({ n: p.n, matches: /keto/.test(p.text) ? ['t'] : [] }));
    const e = new FilterEngine();
    e.configure({ filters: [f('t', 'posts pushing diet culture and weight loss')], ai: true, deep: true, judge });
    const p = post('1', 'Day 3 of keto, down 4 lbs!');
    expect(e.evaluate(p).state).toBe('clear');
    e.request(p);
    await settle();
    expect(e.evaluate(p).state).toBe('filtered');
  });

  test('direct messages never go to the AI', async () => {
    let called = false;
    const e = new FilterEngine();
    e.configure({ filters: [f('a', 'shooting')], ai: true, deep: true, judge: async () => { called = true; return []; } });
    const dm = post('1', 'shooting photos tomorrow?', { visibility: 'direct' });
    e.request(dm);
    await settle();
    expect(called).toBe(false);
    expect(e.evaluate(dm).state).toBe('filtered');
  });

  test('when the AI fails, filters fall back to their words', async () => {
    const e = new FilterEngine();
    e.configure({ filters: [f('a', 'shooting', { action: 'warn' })], ai: true, deep: false, judge: async () => { throw new Error('down'); } });
    const p = post('1', 'Photo shooting');
    e.request(p);
    await settle();
    expect(e.evaluate(p)).toMatchObject({ state: 'filtered', action: 'warn' });
    expect(e.lastError).toBeTruthy();
  });

  test('keyword-only filters skip the AI; hide wins over warn', () => {
    const e = new FilterEngine();
    e.configure({ filters: [f('w', 'spoilers', { action: 'warn', semantic: false }), f('h', 'finale', { semantic: false })], ai: true, deep: false, judge: async () => [] });
    expect(e.evaluate(post('1', 'Spoilers: the finale'))).toMatchObject({ state: 'filtered', action: 'hide' });
  });
});

describe('filter engine: places, own posts, people you follow, reasons', () => {
  test('your own posts are never filtered', () => {
    const e = new FilterEngine();
    e.configure({ filters: [f('a', 'shooting', { semantic: false })], ai: false, deep: false });
    expect(e.evaluate(post('1', 'shooting today', { mine: true })).state).toBe('clear');
  });
  test('a filter applies only in its places', () => {
    const e = new FilterEngine();
    e.configure({ filters: [f('a', 'shooting', { semantic: false, places: ['public'] })], ai: false, deep: false });
    expect(e.evaluate(post('1', 'shooting'), 'home').state).toBe('clear');
    expect(e.evaluate(post('1', 'shooting'), 'public').state).toBe('filtered');
  });
  test('"not from people I follow" waits for Fedizen, then skips followed authors', () => {
    const known = new Map<string, boolean>(), asked: string[] = [];
    const e = new FilterEngine();
    e.configure({ filters: [f('a', 'shooting', { semantic: false, exceptFollowing: true })], ai: false, deep: false, following: { get: id => known.get(id), request: id => asked.push(id) } });
    const friend = post('1', 'shooting', { authorId: 'f1' }), stranger = post('2', 'shooting', { authorId: 's1' });
    expect(e.evaluate(friend).state).toBe('pending');
    e.request(friend); e.request(stranger);
    expect(asked).toEqual(['f1', 's1']);
    known.set('f1', true); known.set('s1', false); e.refresh();
    expect(e.evaluate(friend).state).toBe('clear');
    expect(e.evaluate(stranger).state).toBe('filtered');
  });
  test('the verdict says why: matched words, or the AI model in context', async () => {
    const e = new FilterEngine();
    e.configure({ filters: [f('t', 'posts pushing diet culture')], ai: true, deep: true, judge: async ps => ps.map(p => ({ n: p.n, matches: ['t'] })) });
    const p = post('1', 'Day 3 of keto');
    e.request(p); await settle();
    expect(e.evaluate(p)).toMatchObject({ state: 'filtered', reason: { by: 'ai' } });
    const e2 = new FilterEngine();
    e2.configure({ filters: [f('w', 'spoiler*', { semantic: false, action: 'warn' })], ai: false, deep: false });
    expect(e2.evaluate(post('2', 'spoilers!'))).toMatchObject({ state: 'filtered', action: 'warn', reason: { by: 'words', term: 'spoilers' } });
  });
});
