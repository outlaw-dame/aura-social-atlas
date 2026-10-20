import { describe, it, expect } from 'vitest';
import { extractHashtags, hashtagUrl } from './hashtags';

describe('extractHashtags', () => {
  it('extracts lowercase tag names without the #', () => {
    expect(extractHashtags('#Design #OpenWeb')).toEqual(['design', 'openweb']);
  });

  it('dedupes repeated tags', () => {
    expect(extractHashtags('#art #art #ART')).toEqual(['art']);
  });

  it('rejects all-digit tags like Mastodon', () => {
    expect(extractHashtags('#123 #a1')).toEqual(['a1']);
  });

  it('ignores # mid-word and after URL chars', () => {
    expect(extractHashtags('a#b /#c &#d')).toEqual([]);
  });
});

describe('hashtagUrl', () => {
  it('links to the Mastodon tag page', () => {
    expect(hashtagUrl('openweb')).toBe('https://mastodon.social/tags/openweb');
  });
});
