import { describe, test } from 'node:test';
import { deepStrictEqual } from 'node:assert';
import { creators, matchesCreator, postsByTag } from './social-catalogue';

describe('social discovery filters', () => {
  test('network selection limits matches to that network', () => {
    deepStrictEqual(creators.filter(c => matchesCreator(c, '', 'RSS', 'All topics')).map(c => c.id), ['form']);
  });
  test('search matches creator names without case sensitivity', () => {
    deepStrictEqual(creators.filter(c => matchesCreator(c, 'ORBIT', 'All networks', 'All topics')).map(c => c.id), ['orbit']);
  });
  test('topic and network filters both apply', () => {
    deepStrictEqual(creators.filter(c => matchesCreator(c, '', 'Bluesky', 'Travel')).map(c => c.id), ['elsewhere']);
  });
  test('podcast creators match the Podcasts network filter', () => {
    deepStrictEqual(creators.filter(c => matchesCreator(c, '', 'Podcasts', 'All topics')).map(c => c.id), ['airwaves']);
  });
});

describe('postsByTag', () => {
  test('returns only that creator\'s posts carrying the tag', () => {
    deepStrictEqual(postsByTag('orbit', 'space').map(p => p.id), ['stars', 'moonlight', 'stargazing']);
    deepStrictEqual(postsByTag('orbit', 'travel'), []);
  });
  test('matches tags case-insensitively', () => {
    deepStrictEqual(postsByTag('airwaves', 'Podcasting20').map(p => p.id), ['waves', 'chapters', 'transcripts']);
  });
});
