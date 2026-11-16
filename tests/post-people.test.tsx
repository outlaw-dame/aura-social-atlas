import { describe, test } from 'node:test';
import { strictEqual } from 'node:assert';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement, Fragment } from 'react';
import { linkifyPost, mentionFor } from '../src/components/social/PostPeople';

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
