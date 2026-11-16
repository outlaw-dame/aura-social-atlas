import { describe, expect, test } from 'bun:test';
import { compileFilters, filterKind, filtersVersion, fold, hashtagWords, keywordPattern, lexicalHits, lintFilters, normalizeFilterText, parseFilterList, postText, type ContentFilter, type FilterablePost } from '../src/lib/content-filter';

const f = (text: string, extra: Partial<ContentFilter> = {}): ContentFilter => ({ id: text, text, kind: filterKind(text), action: 'hide', semantic: false, expansions: [], ...extra });
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
