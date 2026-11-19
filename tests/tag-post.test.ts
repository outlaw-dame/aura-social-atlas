import { describe, expect, test } from 'bun:test';
import { gatedTagPost } from '../src/lib/tag-post';
import { postTags, postText } from '../src/lib/content-filter';

const post = { id: 'x1', url: 'https://mastodon.social/@ana/1', createdAt: '2026-11-19T10:00:00Z', text: ['Spoilers for the finale #tvshow'], cw: 'Finale', author: { name: 'Ana', acct: 'ana@fosstodon.org', avatar: 'https://a/a.png', url: 'https://fosstodon.org/@ana' }, replies: 0, boosts: 0, favourites: 0 };

describe('Public hashtag posts go through keyword filters', () => {
  test('the filters read their text, hashtags and content warning', () => {
    const g = gatedTagPost(post);
    expect(postText(g)).toContain('Spoilers for the finale');
    expect(postText(g)).toContain('Finale');
    expect(postTags(g).map(t => t.toLowerCase())).toContain('tvshow');
  });
  test('the hidden-post notice can still say whose post it was', () => {
    expect(gatedTagPost(post)).toMatchObject({ author: 'Ana', handle: '@ana@fosstodon.org', date: '2026-11-19T10:00:00Z' });
  });
});
