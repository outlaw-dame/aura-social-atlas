import { describe, it, expect } from 'vitest';
import { fromBonfireArticles, htmlToParagraphs } from './spotlight';

describe('Bonfire articles', () => {
  it('keeps only items with a real article title', () => {
    const out = fromBonfireArticles([
      { id: 'a', objectPostContent: { name: 'Launch', htmlBody: '<p>Hi</p>' } },
      { id: 'b', objectPostContent: { name: null, htmlBody: '<p>just a post</p>' } },
    ]);
    expect(out.map(a => a.id)).toEqual(['a']);
  });
  it('turns remote HTML into plain text paragraphs', () => {
    expect(htmlToParagraphs('<p>One <script>x</script>&amp; two</p><p>Three</p>')).toEqual(['One x & two', 'Three']);
  });
});
