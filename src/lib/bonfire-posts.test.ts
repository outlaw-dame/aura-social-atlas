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
});
