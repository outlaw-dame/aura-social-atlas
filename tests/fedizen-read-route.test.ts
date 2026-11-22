import { describe, expect, test } from 'bun:test';
import { readRoute } from '../src/lib/fedizen.server';

describe('Fedizen read logs name the route, never who or what', () => {
  test('fixed Mastodon routes stay readable', () => {
    expect(readRoute('/api/v1/follow_requests?limit=40')).toBe('/api/v1/follow_requests');
    expect(readRoute('/api/v2/notifications?limit=40&types%5B%5D=mention')).toBe('/api/v2/notifications');
    expect(readRoute('/api/v1-bonfire/groups')).toBe('/api/v1-bonfire/groups');
  });
  test('ids, handles, hashtags and search terms are hidden', () => {
    expect(readRoute('/api/v1/accounts/01JABCDEF123/statuses?limit=40')).toBe('/api/v1/accounts/:x/statuses');
    expect(readRoute('/api/v1/statuses/abc123/context')).toBe('/api/v1/statuses/:x/context');
    expect(readRoute('/api/v1/timelines/tag/privatething?limit=20')).toBe('/api/v1/timelines/tag/:x');
    expect(readRoute('/api/v1/accounts/lookup?acct=ann%40example.social')).toBe('/api/v1/accounts/lookup');
    expect(readRoute('/api/v1/timelines/list/Close%20Friends')).toBe('/api/v1/timelines/list/:x');
  });
});
