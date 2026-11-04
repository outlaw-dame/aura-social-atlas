import { describe, test } from 'node:test';
import { deepStrictEqual } from 'node:assert';
import { fromBonfireArticles, htmlToParagraphs } from './spotlight';

describe('Bonfire articles', () => {
  test('keeps only items with a real article title', () => {
    const out = fromBonfireArticles([
      { id: 'a', objectPostContent: { name: 'Launch', htmlBody: '<p>Hi</p>' } },
      { id: 'b', objectPostContent: { name: null, htmlBody: '<p>just a post</p>' } },
    ]);
    deepStrictEqual(out.map(a => a.id), ['a']);
  });
  test('turns remote HTML into plain text and drops scripts', () => {
    deepStrictEqual(htmlToParagraphs('<p>One <script>alert(1)</script>&amp; two</p><p>Three</p>'), ['One & two', 'Three']);
  });
});
