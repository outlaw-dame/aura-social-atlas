import { describe, test } from 'node:test';
import { strictEqual } from 'node:assert';
import { deepStrictEqual } from 'node:assert';
import { allowedCallback, FEDIZEN_API_SCOPE, fromConversations, hasScope, safeReturnPath } from './fedizen-feed';

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
    strictEqual(allowedCallback('https://atlas.lovable.app'), 'https://atlas.lovable.app/fedizen/callback');
    strictEqual(allowedCallback('https://evil.example'), null);
    strictEqual(allowedCallback('http://atlas.lovable.app'), null);
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
