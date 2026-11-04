import { describe, test } from 'node:test';
import { deepStrictEqual, strictEqual } from 'node:assert';
import { fromBonfirePosts } from './spotlight';

describe('public Fedizen feed mapping', () => {
  test('keeps short posts without a title and strips remote HTML', () => {
    const [p] = fromBonfirePosts([{ id: 'a', objectPostContent: { htmlBody: '<p>Hi <script>x()</script><b>there</b></p>' }, subject: { character: { username: 'Strypey' }, profile: { name: 'Strypey' } } }]);
    deepStrictEqual(p.paragraphs, ['Hi there']);
    strictEqual(p.handle, '@Strypey@fedizen.net');
  });
  test('drops non-https avatar and empty posts', () => {
    const r = fromBonfirePosts([{ id: 'b', objectPostContent: { htmlBody: '<p>x</p>' }, subject: { profile: { icon: 'javascript:alert(1)' } } }, { id: 'c', objectPostContent: { htmlBody: '' } }]);
    strictEqual(r.length, 1); strictEqual(r[0].avatar, undefined);
  });
  test('credits boosts to the original author and shows each post once', () => {
    const body = { htmlBody: '<p>Original</p>' };
    const r = fromBonfirePosts([
      { id: 'create', verb: { verb: 'Create' }, objectPostContent: body, subject: { character: { username: 'ann@mastodon.social' } }, object: { id: 'obj1' } },
      { id: 'boost', verb: { verb: 'Boost' }, objectPostContent: body, subject: { profile: { name: 'Bob' } }, object: { id: 'obj1', creator: { character: { username: 'ann@mastodon.social' } } } },
      { id: 'boost2', verb: { verb: 'Boost' }, objectPostContent: { htmlBody: '<p>Other</p>' }, subject: { profile: { name: 'Bob' } }, object: { id: 'obj2', creator: { character: { username: 'cy' } } } },
    ]);
    strictEqual(r.length, 2);
    strictEqual(r[1].handle, '@cy@fedizen.net');
    strictEqual(r[1].boostedBy, 'Bob');
    strictEqual(r[0].boostedBy, undefined);
  });
});
