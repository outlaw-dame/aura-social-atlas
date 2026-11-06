import { describe, expect, test } from 'bun:test';
import { cleanText, hashtagNames, htmlToText } from './sanitize.ts';

describe('remote-content presentation', () => {
  test('stores plain text, never HTML/JS', () => {
    const input = '<script>alert("bad")</script><p>Hello <strong>world</strong> &amp; friends</p>';
    const output = htmlToText(input, 1000);
    expect(output).toContain('Hello world & friends');
    expect(output).not.toContain('<script');
    expect(output).not.toContain('alert(');
    expect(cleanText('A &amp; B', 100)).toBe('A & B');
  });
  test('normalizes ActivityStreams Hashtag tags', () => {
    expect(hashtagNames([
      { type: 'Hashtag', name: '#ActivityPub' },
      { type: 'Hashtag', name: 'ActivityPub' },
      { type: 'Mention', name: '#NotAHashtag' },
      { type: 'Hashtag', name: '#My_Tag' },
    ])).toEqual(['activitypub', 'my_tag']);
    expect(hashtagNames({ type: 'Hashtag', name: '#OneTag' })).toEqual(['onetag']);
    expect(hashtagNames({ type: 'https://www.w3.org/ns/activitystreams#Hashtag', name: '#Canonical' })).toEqual(['canonical']);
    expect(hashtagNames({ type: 'Mention', name: '#Incorrect' })).toEqual([]);
    expect(hashtagNames('#not-structured')).toEqual([]);
  });
});
