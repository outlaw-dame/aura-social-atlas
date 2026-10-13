import { describe, test } from 'node:test';
import { deepStrictEqual } from 'node:assert';
import { creators, matchesCreator } from './social-catalogue';

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
});
