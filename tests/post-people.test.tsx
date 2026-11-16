import { describe, test } from 'node:test';
import { strictEqual } from 'node:assert';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement, Fragment } from 'react';
import { linkifyPost, mentionFor, shownUrl, trimUrl } from '../src/components/social/PostPeople';

const mentions = [{ acct: 'nedley@mastodon.social', username: 'nedley' }, { acct: 'meganl@fedizen.net', username: 'meganl' }];
const html = (text: string, m = mentions) => renderToStaticMarkup(createElement(Fragment, null, ...linkifyPost(text, m, () => {})));

describe('mentions in a post', () => {
  test('a written @name is the mention by that name; a whole handle must match whole', () => {
    strictEqual(mentionFor('nedley', mentions)?.acct, 'nedley@mastodon.social');
    strictEqual(mentionFor('MeganL', mentions)?.acct, 'meganl@fedizen.net');
    strictEqual(mentionFor('nedley@evil.example', mentions), undefined);
    strictEqual(mentionFor('someone', mentions), undefined);
  });
  test('resolved mentions become buttons; the rest stays text', () => {
    const out = html('@nedley and @someone, hi.');
    strictEqual((out.match(/<button/g) ?? []).length, 1);
    strictEqual(out.includes('>@nedley</button> and @someone, hi.'), true);
  });
  test('a trailing full stop is not part of the handle; e-mail addresses are not mentions', () => {
    const out = html('Thanks @meganl. Mail me at nedley@mastodon.social');
    strictEqual(out.includes('>@meganl</button>. Mail me at nedley@mastodon.social'), true);
    strictEqual((out.match(/<button/g) ?? []).length, 1);
  });
  test('hashtags still link beside mentions', () => {
    const out = html('@nedley #Atlas');
    strictEqual((out.match(/<button/g) ?? []).length, 2);
  });
  test('without mentions, text is only hashtag-linked', () => strictEqual(html('@nedley hi', []).includes('<button'), false));
});

describe('mentions and hashtags together', () => {
  test('stretches of text never share React keys', () => {
    const nodes = linkifyPost('#one @nedley #two @meganl #three', mentions, () => {});
    const keys = nodes.map(n => (n as { key?: string | null }).key);
    strictEqual(keys.every(k => k != null), true);
    strictEqual(new Set(keys).size, keys.length);
  });
});

describe('links in a post', () => {
  test('a link ends before closing punctuation, and keeps a bracket it opened', () => {
    strictEqual(trimUrl('https://example.com/a.'), 'https://example.com/a');
    strictEqual(trimUrl('https://example.com/a),'), 'https://example.com/a');
    strictEqual(trimUrl('https://en.wikipedia.org/wiki/Bear_(disambiguation)'), 'https://en.wikipedia.org/wiki/Bear_(disambiguation)');
  });
  test('reads short, as Mastodon shows it', () => {
    strictEqual(shownUrl('https://www.example.com/x'), 'example.com/x');
    strictEqual(shownUrl('https://www.nytimes.com/2026/11/16/us/some-long-story.html'), 'nytimes.com/2026/11/16/us/some…');
  });
  test('links open in a new tab, beside mentions and hashtags', () => {
    const out = html('@nedley see https://example.com/a/b. #Atlas');
    strictEqual(out.includes('<a href="https://example.com/a/b" target="_blank" rel="noopener noreferrer nofollow ugc"'), true);
    strictEqual(out.includes('>example.com/a/b</a>. '), true);
    strictEqual((out.match(/<button/g) ?? []).length, 2);
  });
  test('only http and https', () => strictEqual(html('javascript:alert(1) ftp://x.org', []).includes('<a '), false));
});
