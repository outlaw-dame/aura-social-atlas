import { describe, test } from 'node:test';
import { strictEqual } from 'node:assert';
import { linkAuthor } from './spotlight';
describe('linkAuthor', () => {
  test('uses the linked fediverse account like Mastodon "More from"', () => {
    const r = linkAuthor({ authors: [{ name: 'Jo', account: { display_name: 'Jo D', acct: 'jo@news.social', url: 'https://news.social/@jo' } }] });
    strictEqual(r.authorAccount?.acct, '@jo@news.social');
  });
  test('falls back to plain byline when no account', () => {
    strictEqual(linkAuthor({ author_name: 'Sam' }).authorAccount, undefined);
    strictEqual(linkAuthor({ author_name: 'Sam' }).author, 'Sam');
  });
});
