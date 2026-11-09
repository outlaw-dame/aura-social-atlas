import { describe, expect, mock, test } from 'bun:test';
import {
  NATIVE_POST_BY_ID_DOCUMENT, NATIVE_PROFILE_BY_ID_DOCUMENT,
  NATIVE_PROFILE_BY_USERNAME_DOCUMENT,
} from '../src/lib/bonfire/graphql/operations';
import {
  normalizeNativeBonfirePost, profileSelectorSchema,
  readNativeBonfirePost, readNativeBonfireProfile,
} from '../src/lib/bonfire-detail.server';

const respond = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
const user = {
  id: 'bonfire-user-1',
  character: { username: 'example', canonicalUri: 'https://fedizen.net/@example' },
  profile: { name: 'Example', summary: '<b>Visible</b>', icon: null, image: null, website: null, location: null },
  followersCount: 9, followingCount: 3, statusesCount: 12,
};
const post = {
  id: 'post-1',
  postContent: { name: 'A heading', summary: 'A summary', htmlBody: '<p>Hello <strong>world</strong></p><script>alert(1)</script><p>Next</p>' },
  creator: { character: { username: 'example', canonicalUri: null }, profile: { name: 'Example', icon: null } },
  activity: { id: 'activity-1', date: null, canonicalUri: 'https://fedizen.net/post/1',
    repliesCount: 3, likeCount: 5, boostCount: 1, likedByMe: true, boostedByMe: false, bookmarkedByMe: true },
};

describe('Bonfire deployed-schema profile and post detail readers', () => {
  test('queries username profiles using a static document and server-only bearer', async () => {
    const fetchImpl = mock(async (url: RequestInfo | URL, init?: RequestInit) => {
      expect(String(url)).toBe('https://fedizen.net/api/graphql');
      expect(init?.method).toBe('POST');
      expect(init?.redirect).toBe('error');
      expect(init?.cache).toBe('no-store');
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer read-fixture');
      const request = JSON.parse(String(init?.body));
      expect(request.query).toBe(NATIVE_PROFILE_BY_USERNAME_DOCUMENT);
      expect(request.variables).toEqual({ username: 'example' });
      return respond({ data: { user } });
    }) as typeof fetch;
    expect(await readNativeBonfireProfile('read-fixture', { by: 'username', value: 'example' }, { fetchImpl }))
      .toEqual(user);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  test('uses a different static document for profile ID lookup', async () => {
    const fetchImpl = mock(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body));
      expect(request.query).toBe(NATIVE_PROFILE_BY_ID_DOCUMENT);
      expect(request.variables).toEqual({ id: 'profile-1' });
      return respond({ data: { user: null } });
    }) as typeof fetch;
    expect(await readNativeBonfireProfile('read-fixture', { by: 'id', value: 'profile-1' }, { fetchImpl }))
      .toBeNull();
  });

  test('fails before network for invalid usernames, selectors and control characters', async () => {
    const fetchImpl = mock(async () => respond({ data: { user } })) as typeof fetch;
    for (const bad of ['example/../../admin', 'name?q=true', '', ' '.repeat(2), 'a'.repeat(321)]) {
      await expect(readNativeBonfireProfile('read-fixture', { by: 'username', value: bad }, { fetchImpl }))
        .rejects.toThrow();
    }
    expect(() => profileSelectorSchema.parse({ by: 'unknown', value: 'example' })).toThrow();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test('queries post by bounded ID with no dynamic selection injection', async () => {
    const fetchImpl = mock(async (url: RequestInfo | URL, init?: RequestInit) => {
      expect(String(url)).toBe('https://fedizen.net/api/graphql');
      const request = JSON.parse(String(init?.body));
      expect(request.query).toBe(NATIVE_POST_BY_ID_DOCUMENT);
      expect(request.variables).toEqual({ id: 'post-1' });
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer read-fixture');
      return respond({ data: { post } });
    }) as typeof fetch;
    const result = await readNativeBonfirePost('read-fixture', 'post-1', { fetchImpl });
    expect(result).toMatchObject({
      id: 'post-1', title: 'A heading', summary: 'A summary',
      creator: { name: 'Example', username: 'example' },
      activity: { likedByMe: true, boostedByMe: false, bookmarkedByMe: true },
    });
    expect(result?.paragraphs).toEqual(['Hello world', 'Next']);
    expect(JSON.stringify(result)).not.toContain('<script>');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  test('handles missing remote creator fragments without misattributing a post', () => {
    const normalized = normalizeNativeBonfirePost({ ...post, creator: {}, activity: null });
    expect(normalized?.creator).toEqual({ name: null, username: null, icon: null });
  });

  test('missing or unauthorized post is null, not an invented record', async () => {
    const fetchImpl = mock(async () => respond({ data: { post: null } })) as typeof fetch;
    expect(await readNativeBonfirePost('read-fixture', 'post-1', { fetchImpl })).toBeNull();
  });

  test('GraphQL errors and malformed detail data fail closed', async () => {
    const graphError = mock(async () => respond({ data: { post }, errors: [{ message: 'private' }] })) as typeof fetch;
    await expect(readNativeBonfirePost('token', 'post-1', { fetchImpl: graphError }))
      .rejects.toMatchObject({ kind: 'graphql' });
    const malformed = mock(async () => respond({ data: { post: { id: 'post-1', postContent: { htmlBody: true } } } })) as typeof fetch;
    await expect(readNativeBonfirePost('token', 'post-1', { fetchImpl: malformed }))
      .rejects.toMatchObject({ kind: 'invalid-response' });
    const unauth = mock(async () => respond({ error: 'unauthorized' }, 401)) as typeof fetch;
    await expect(readNativeBonfirePost('token', 'post-1', { fetchImpl: unauth }))
      .rejects.toMatchObject({ kind: 'http', status: 401 });
    expect(unauth).toHaveBeenCalledTimes(1);
  });

  test('strict URL/ID size, cursor-like injection and malformed reaction counts rejected', async () => {
    const fetchImpl = mock(async () => respond({ data: { post } })) as typeof fetch;
    for (const bad of ['', 'post\nother', 'x'.repeat(321)]) {
      await expect(readNativeBonfirePost('token', bad, { fetchImpl })).rejects.toThrow();
    }
    expect(fetchImpl).not.toHaveBeenCalled();
    const wrongCounts = mock(async () => respond({ data: { post: { ...post, activity: { ...post.activity, likeCount: -1 } } } })) as typeof fetch;
    await expect(readNativeBonfirePost('token', 'post-1', { fetchImpl: wrongCounts }))
      .rejects.toMatchObject({ kind: 'invalid-response' });
  });
});
