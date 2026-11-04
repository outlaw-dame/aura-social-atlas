import { describe, it, expect } from 'vitest';
import { linkAuthor } from './spotlight';
describe('linkAuthor', () => {
  it('uses the linked fediverse account like Mastodon "More from"', () => {
    const r = linkAuthor({ authors: [{ name: 'Jo', account: { display_name: 'Jo D', acct: 'jo@news.social', url: 'https://news.social/@jo' } }] });
    expect(r.authorAccount?.acct).toBe('@jo@news.social');
  });
  it('falls back to plain byline when no account', () => {
    expect(linkAuthor({ author_name: 'Sam' }).authorAccount).toBeUndefined();
    expect(linkAuthor({ author_name: 'Sam' }).author).toBe('Sam');
  });
});
