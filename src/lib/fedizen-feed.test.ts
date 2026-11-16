import { describe, test } from 'node:test';
import { strictEqual } from 'node:assert';
import { deepStrictEqual } from 'node:assert';
import { allowedCallback, articleLinkIn, FEDIZEN_API_SCOPE, fromConversations, fromStatuses, hasScope, safeReturnPath } from './fedizen-feed';

describe('Fedizen connection', () => {
  test('asks Fedizen to read and to act for the person', () => strictEqual(FEDIZEN_API_SCOPE, 'read write follow'));
  test('a parent scope covers its children; an older read-only grant does not cover writes', () => {
    strictEqual(hasScope('read write follow', 'write'), true);
    strictEqual(hasScope('read write', 'write:follows'), true);
    strictEqual(hasScope('read', 'write'), false);
    strictEqual(hasScope(null, 'read'), false);
  });
  test('returns only to same-site paths after connecting', () => {
    strictEqual(safeReturnPath('/groups?group=01ABC'), '/groups?group=01ABC');
    strictEqual(safeReturnPath('/app'), '/app');
    strictEqual(safeReturnPath('//evil.example'), '/feeds');
    strictEqual(safeReturnPath('/\\evil.example'), '/feeds');
    strictEqual(safeReturnPath('https://evil.example'), '/feeds');
    strictEqual(safeReturnPath('/fedizen/callback'), '/feeds');
    strictEqual(safeReturnPath(null), '/feeds');
  });
  test('returns codes only to Atlas hosts', () => {
    strictEqual(allowedCallback('https://aura-social-atlas.lovable.app', 'https://aura-social-atlas.lovable.app'), 'https://aura-social-atlas.lovable.app/fedizen/callback');
    strictEqual(allowedCallback('https://atlas.lovable.app', 'https://atlas.lovable.app'), null); // another Lovable tenant
    strictEqual(allowedCallback('https://evil.example', 'https://evil.example'), null);
    strictEqual(allowedCallback('http://atlas.lovable.app', 'http://atlas.lovable.app'), null);
  });
});

describe('Fedizen messages', () => {
  test('a Mastodon conversation becomes the people in it and its latest message as plain text', () => {
    const [c] = fromConversations([{ id: '7', unread: true, accounts: [{ display_name: 'Ana', acct: 'ana@lemmy.ca', avatar: 'https://lemmy.ca/a.png' }],
      last_status: { id: 's', content: '<p>Hi <script>x</script><b>there</b></p>', created_at: '2026-11-14T12:00:00Z', url: 'https://fedizen.net/post/s' } }] as never);
    deepStrictEqual(c.people, [{ name: 'Ana', handle: '@ana@lemmy.ca', avatar: 'https://lemmy.ca/a.png' }]);
    strictEqual(c.unread, true);
    strictEqual(c.url, 'https://fedizen.net/post/s');
    strictEqual(c.text.includes('<'), false);
  });
  test('unsafe links and missing fields are dropped, not shown', () => {
    const [c] = fromConversations([{ id: '8', accounts: [{ acct: 'bo', avatar: 'javascript:alert(1)' }], last_status: { id: 's', url: 'javascript:alert(1)' } }] as never);
    strictEqual(c.people[0].avatar, undefined);
    strictEqual(c.url, undefined);
    strictEqual(c.unread, false);
    strictEqual(c.text, '');
  });
});

describe('Saved and Circles mapping', () => {
  test('a boost is saved as the boosted post, and its saved state is kept', async () => {
    const { fromStatuses } = await import('./fedizen-feed');
    const [p] = fromStatuses([{ id: 'b1', account: { display_name: 'Bo' }, reblog: { id: 'o1', bookmarked: true, content: '<p>hi</p>' } }] as never);
    strictEqual(p.statusId, 'o1');
    strictEqual(p.bookmarked, true);
  });
  test('circles and people map without unsafe avatars; handles are checked before lookup', async () => {
    const { fromLists, fromAccounts, lookupAcct } = await import('./fedizen-feed');
    deepStrictEqual(fromLists([{ id: '1', title: ' Close friends ' }, { id: '2', title: '' }]), [{ id: '1', title: 'Close friends' }, { id: '2', title: 'Untitled circle' }]);
    deepStrictEqual(fromAccounts([{ id: 'a', acct: 'ana@lemmy.ca', avatar: 'javascript:x' }, { acct: 'no-id' }] as never), [{ id: 'a', name: 'ana', handle: '@ana@lemmy.ca', avatar: undefined }]);
    strictEqual(lookupAcct('@ana@lemmy.ca'), 'ana@lemmy.ca');
    strictEqual(lookupAcct('bo'), 'bo');
    strictEqual(lookupAcct('a/b@x'), null);
    strictEqual(lookupAcct('ana@lemmy.ca/../x'), null);
  });
});

describe('Article links in posts ("More from")', () => {
  const html = '<p>Hi <span class="h-card"><a href="https://social.example/@ann" class="u-url mention">@ann</a></span> '
    + '<a href="https://social.example/tags/news" class="mention hashtag" rel="tag">#news</a> '
    + '<a href="https://mastodon.example/collections/abc">list</a> '
    + '<a href="https://news.org/2026/story?a=1&amp;b=2" rel="nofollow noopener" target="_blank">story</a></p>';
  test('skips mentions, hashtags and collection links; takes the first ordinary link', () =>
    strictEqual(articleLinkIn(html), 'https://news.org/2026/story?a=1&b=2'));
  test('ignores non-https and private hosts', () => {
    strictEqual(articleLinkIn('<a href="http://news.org/x">x</a>'), undefined);
    strictEqual(articleLinkIn('<a href="https://192.168.1.4/x">x</a>'), undefined);
    strictEqual(articleLinkIn('<a href="https://localhost/x">x</a>'), undefined);
  });
  test('prefers Bonfire’s link preview and keeps its title and byline', () => {
    const [p] = fromStatuses([{ id: '1', url: 'https://fedizen.net/post/1', content: '<p>read</p>', created_at: '2026-11-01T00:00:00Z',
      account: { display_name: 'A', acct: 'a' }, card: { url: 'https://news.org/a', title: ' A story ', provider_name: 'News', author_name: 'Bea Writer' } }] as never);
    deepStrictEqual(p.article, { url: 'https://news.org/a', title: 'A story', provider: 'News', byline: 'Bea Writer' });
  });
  test('without a preview, uses the link in the text with no borrowed title', () => {
    const [p] = fromStatuses([{ id: '2', url: 'https://fedizen.net/post/2', content: html, created_at: '2026-11-01T00:00:00Z', account: { display_name: 'A', acct: 'a' }, card: null }] as never);
    deepStrictEqual(p.article, { url: 'https://news.org/2026/story?a=1&b=2', title: undefined, provider: undefined, byline: undefined });
  });
  test('no article when the post links nowhere', () => {
    const [p] = fromStatuses([{ id: '3', url: 'https://fedizen.net/post/3', content: '<p>plain</p>', created_at: '2026-11-01T00:00:00Z', account: { display_name: 'A', acct: 'a' } }] as never);
    strictEqual('article' in p, false);
  });
});

describe('People in Fedizen posts', () => {
  // Shapes as fedizen.net's /api/v1/timelines/public returns them (Bonfire's Mastodon API).
  const status = {
    id: 'r1', created_at: '2026-11-15T00:00:00Z',
    account: { display_name: 'Anime', acct: 'anime', username: 'anime', avatar: 'https://fedizen.net/a.png', url: 'https://fedizen.net/pub/actors/anime' },
    reblog: {
      id: 'o1', created_at: '2026-11-14T00:00:00Z',
      content: '<p><span class="h-card"><a rel="nofollow noopener" href="/@nedley@mastodon.social">@<span>nedley</span></a></span> Fascinating! <a href="https://example.com/a/b"><span class="invisible">https://</span><span class="ellipsis">example.com/a</span><span class="invisible">/b</span></a></p>',
      account: { display_name: '', acct: 'THEPIGWHODIDIT@lemmy.world', username: 'THEPIGWHODIDIT@lemmy.world', url: 'https://lemmy.world/u/THEPIGWHODIDIT', uri: 'https://lemmy.world/u/THEPIGWHODIDIT' },
      mentions: [{ acct: 'nedley@mastodon.social', username: 'nedley@mastodon.social', url: 'https://fedizen.net/@nedley@mastodon.social' }],
    },
  };
  test('a mention reads as written, with no space after the @, and a split link comes back whole', () => {
    const [p] = fromStatuses([status] as never);
    deepStrictEqual(p.paragraphs, ['@nedley Fascinating! https://example.com/a/b']);
    deepStrictEqual(p.mentions, [{ acct: 'nedley@mastodon.social', username: 'nedley' }]);
  });
  test('an account with no display name goes by its handle’s first part, not the whole handle', () => {
    const [p] = fromStatuses([status] as never);
    strictEqual(p.author, 'THEPIGWHODIDIT');
    strictEqual(p.handle, '@THEPIGWHODIDIT@lemmy.world');
    strictEqual(p.acct, 'THEPIGWHODIDIT@lemmy.world');
    strictEqual(p.actor, 'https://lemmy.world/u/THEPIGWHODIDIT');
  });
  test('a boost carries who boosted it: name, avatar, and what opens their profile', () => {
    const [p] = fromStatuses([status] as never);
    strictEqual(p.boostedBy, 'Anime');
    deepStrictEqual(p.booster, { name: 'Anime', avatar: 'https://fedizen.net/a.png', acct: 'anime@fedizen.net', actor: 'https://fedizen.net/pub/actors/anime' });
  });
  test('only public https actors are kept', () => {
    const [p] = fromStatuses([{ id: 'x', content: '<p>x</p>', account: { acct: 'a@b.example', url: 'javascript:alert(1)' } }] as never);
    strictEqual(p.actor, undefined);
    strictEqual(p.acct, 'a@b.example');
  });
});
