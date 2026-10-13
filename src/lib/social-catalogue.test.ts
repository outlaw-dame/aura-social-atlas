import { describe, expect, test } from 'bun:test';
import { creators, matchesCreator } from './social-catalogue';

describe('social discovery filters', () => {
  test('network selection limits matches to that network', () => {
    expect(creators.filter(c => matchesCreator(c, '', 'RSS', 'All topics')).map(c => c.id)).toEqual(['form']);
  });
  test('search matches creator names without case sensitivity', () => {
    expect(creators.filter(c => matchesCreator(c, 'ORBIT', 'All networks', 'All topics')).map(c => c.id)).toEqual(['orbit']);
  });
  test('topic and network filters both apply', () => {
    expect(creators.filter(c => matchesCreator(c, '', 'Bluesky', 'Travel')).map(c => c.id)).toEqual(['elsewhere']);
  });
});
