import { describe, expect, test } from 'bun:test';
import { applies, compileFilters, filterKind, filtersVersion, fold, fromMastodonExport, hashtagWords, keywordPattern, lexicalHits, lintFilters, normalizeFilterText, parseFilterList, postText, strongest, toMastodonExport, type ContentFilter, type FilterablePost } from '../src/lib/content-filter';

const f = (text: string, extra: Partial<ContentFilter> = {}): ContentFilter => ({ id: text, text, kind: filterKind(text), action: 'hide', semantic: false, expansions: [], places: ['home', 'public', 'account'], expiresAt: null, exceptFollowing: false, ...extra });
const post = (text: string, extra: Partial<FilterablePost> = {}): FilterablePost => ({ id: '1', paragraphs: [text], ...extra });
const hits = (filters: ContentFilter[], p: FilterablePost) => lexicalHits(compileFilters(filters), p).map(h => `${h.filterId}:${h.via}`);

describe('filter kinds', () => {
  test('hashtag, word, phrase and topic', () => {
    expect(filterKind('#urbanism')).toBe('hashtag');
    expect(filterKind('spam*')).toBe('word');
    expect(filterKind('climate change')).toBe('phrase');
    expect(filterKind('posts mocking people for their weight')).toBe('topic');
  });
  test('cleans input and pasted lists', () => {
    expect(normalizeFilterText('  crypto\tgiveaway \n')).toBe('crypto giveaway');
    expect(normalizeFilterText(' * ')).toBeNull();
    expect(parseFilterList('spam\nSpam, crypto*;  #nft\n\n')).toEqual(['spam', 'crypto*', '#nft']);
  });
});

describe('matching like Bonfire, minus what made it lossy', () => {
  test('whole words; * runs into longer words', () => {
    expect(hits([f('spam')], post('Spam!'))).toEqual(['spam:keyword']);
    expect(hits([f('spam')], post('a spammer'))).toEqual([]);
    expect(hits([f('spam*')], post('a spammer'))).toEqual(['spam*:keyword']);
    expect(hits([f('*spam')], post('antispam tools'))).toEqual(['*spam:keyword']);
    expect(hits([f('spam')], post('#spam'))).toEqual(['spam:keyword']);
  });
  test('no "rn" → "m" folding: bum does not hide burn, com does not hide corn', () => {
    expect(hits([f('bum')], post('Slow burn'))).toEqual([]);
    expect(hits([f('com')], post('Sweet corn'))).toEqual([]);
  });
  test('look-alikes still fold: C00L, Cyrillic and invisible characters', () => {
    expect(fold('C00L')).toBe('cool');
    expect(fold('2024')).toBe('2024');
    expect(hits([f('cool')], post('so C00L'))).toEqual(['cool:keyword']);
    expect(hits([f('scam')], post('ѕсаm alert'))).toEqual(['scam:keyword']);
    expect(hits([f('scam')], post('s​cam'))).toEqual(['scam:keyword']);
    expect(hits([f('cafe')], post('Café opening'))).toEqual(['cafe:keyword']);
  });
  test('phrases tolerate hyphens and line breaks', () => {
    expect(hits([f('climate change')], post('Climate-change policy'))).toEqual(['climate change:keyword']);
    expect(keywordPattern('climate change')!.test(fold('climate\nchange'))).toBe(true);
  });
  test('hashtags: the tag itself, case and underscores aside; a phrase reads CamelCase hashtags', () => {
    expect(hashtagWords('#ClimateChange')).toBe('Climate Change');
    expect(hits([f('#ClimateChange')], post('hello #climate_change'))).toEqual(['#ClimateChange:hashtag']);
    expect(hits([f('#urbanism')], post('urbanism talk'))).toEqual([]);
    expect(hits([f('climate change')], post('new post', { tags: ['ClimateChange'] }))).toEqual(['climate change:keyword']);
  });
  test('reads content warnings, image descriptions and link titles', () => {
    expect(hits([f('spoilers')], post('…', { cw: 'Spoilers for the finale' }))).toEqual(['spoilers:keyword']);
    expect(hits([f('spider')], post('look', { alt: ['A spider on a web'] }))).toEqual(['spider:keyword']);
    expect(hits([f('election')], post('read this', { linkTitle: 'Election results live' }))).toEqual(['election:keyword']);
  });
  test('topics match only through wordings the AI model added', () => {
    const topic = f('posts mocking people for their weight', { expansions: ['fat shaming', '#fatshaming'] });
    expect(hits([topic], post('Stop the fat-shaming'))).toEqual([`${topic.id}:expansion`]);
    expect(hits([topic], post('weight lifting tips'))).toEqual([]);
  });
});

describe('looking over a list', () => {
  test('flags short wildcards, short bare words and repeats', () => {
    const issues = lintFilters([f('ass*'), f('*war*'), f('ai'), f('Spam'), f('spam')]).map(i => i.filterId);
    expect(issues).toEqual(['ass*', '*war*', 'ai', 'spam']);
  });
  test('version changes with the filters', () => {
    expect(filtersVersion([f('a')], 'ai')).not.toBe(filtersVersion([f('a', { action: 'warn' })], 'ai'));
  });
  test('text for the model is capped', () => {
    expect(postText(post('x'.repeat(3000))).length).toBe(1500);
  });
});

describe('what Bluesky and Mastodon taught', () => {
  test('words in scripts without spaces match anywhere (Bluesky)', () => {
    expect(hits([f('政治')], post('今日は政治について話そう'))).toEqual(['政治:keyword']);
    expect(hits([f('선거')], post('선거가 다가온다'))).toEqual(['선거:keyword']);
    expect(hits([f('การเมือง')], post('วันนี้คุยเรื่องการเมือง'))).toEqual(['การเมือง:keyword']);
  });
  test('letters split by dots or hyphens read as the word, but a slash stays (Bluesky)', () => {
    expect(hits([f('nft')], post('buy n-f-t now'))).toEqual(['nft:keyword']);
    expect(hits([f('spam')], post('s.p.a.m'))).toEqual(['spam:keyword']);
    expect(hits([f('andor')], post('and/or'))).toEqual([]);
  });
  test('reads the quoted post, link description and poll options', () => {
    expect(hits([f('election')], post('look', { quote: 'Election night thread' }))).toEqual(['election:keyword']);
    expect(hits([f('recipe')], post('look', { linkTitle: 'Dinner', linkDescription: 'A quick recipe' }))).toEqual(['recipe:keyword']);
    expect(hits([f('pineapple')], post('Pizza?', { poll: ['Pineapple', 'No'] }))).toEqual(['pineapple:keyword']);
  });
  test('the matched words are reported, for “why was this filtered”', () => {
    const [h] = lexicalHits(compileFilters([f('spoiler*')]), post('Huge SPOILERS ahead'));
    expect(h.term).toBe('spoilers');
  });
  test('expiry and places', () => {
    const past = new Date(Date.now() - 1000).toISOString(), future = new Date(Date.now() + 60_000).toISOString();
    expect(applies(f('a', { expiresAt: past }), 'home')).toBe(false);
    expect(applies(f('a', { expiresAt: future }), 'home')).toBe(true);
    expect(applies(f('a', { places: ['public'] }), 'home')).toBe(false);
  });
  test('hide beats a warning, a warning beats blurred media', () => {
    expect(strongest([f('a', { action: 'blur' }), f('b', { action: 'warn' })])?.id).toBe('b');
    expect(strongest([f('a', { action: 'warn' }), f('b', { action: 'hide' })])?.id).toBe('b');
  });
});

describe('Mastodon import and export', () => {
  test('round trip keeps action, places, expiry, wildcards and wordings', () => {
    const exp = new Date(Date.now() + 86_400_000).toISOString();
    const out = toMastodonExport([f('spoiler*', { action: 'warn', places: ['home'], expiresAt: exp, expansions: ['finale leak'] })]);
    expect(out.custom_filters[0]).toMatchObject({ title: 'spoiler*', action: 'warn', context: ['home'], expires_at: exp });
    expect(out.custom_filters[0].keywords_attributes).toEqual([{ keyword: 'spoiler', whole_word: false }, { keyword: 'finale leak', whole_word: true }]);
    const back = fromMastodonExport(JSON.parse(JSON.stringify(out)))!;
    expect(back.map(b => b.text)).toEqual(['*spoiler*', 'finale leak']);
    expect(back[0]).toMatchObject({ action: 'warn', places: ['home'], expiresAt: exp });
  });
  test('reads a real Mastodon export; unknown contexts fall back to everywhere; junk is refused', () => {
    const real = { custom_filters: [{ title: 'Politics', expires_at: null, context: ['notifications', 'thread'], action: 'hide', keywords_attributes: [{ keyword: 'senate', whole_word: true }], statuses: ['https://x/1'] }] };
    expect(fromMastodonExport(real)).toEqual([{ text: 'senate', action: 'hide', places: ['home', 'public', 'account'], expiresAt: null }]);
    expect(fromMastodonExport({ nope: 1 })).toBeNull();
  });
});

test('a two-character word in a script without spaces is not "very short"', () => {
  expect(lintFilters([f('政治')])).toEqual([]);
});
