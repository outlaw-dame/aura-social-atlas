import { describe, test } from 'node:test';
import { deepStrictEqual, strictEqual } from 'node:assert';
import { extractHashtags, hashtagUrl } from './hashtags';

describe('extractHashtags', () => {
  test('extracts lowercase tag names without the #', () => {
    deepStrictEqual(extractHashtags('#Design #OpenWeb'), ['design', 'openweb']);
  });

  test('dedupes repeated tags', () => {
    deepStrictEqual(extractHashtags('#art #art #ART'), ['art']);
  });

  test('rejects all-digit tags like Mastodon', () => {
    deepStrictEqual(extractHashtags('#123 #a1'), ['a1']);
  });

  test('ignores # mid-word and after URL chars', () => {
    deepStrictEqual(extractHashtags('a#b /#c &#d'), []);
  });
});

describe('hashtagUrl', () => {
  test('links to the Mastodon tag page', () => {
    strictEqual(hashtagUrl('openweb'), '/tags/openweb');
  });
});
