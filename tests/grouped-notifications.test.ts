import { describe, expect, test } from 'bun:test';
import { fromGroupedNotifications, groupSentence, mergeNoticeGroups } from '../src/lib/fedizen-feed';

const acct = (id: string, name: string) => ({ id, display_name: name, acct: `${name.toLowerCase()}@example.social`, url: `https://example.social/users/${name.toLowerCase()}` });

describe('Grouped notifications (Mastodon 4.3, through Fedizen)', () => {
  const page = (groups: object[], statuses = [{ id: 's1', content: '<p>My post</p>' }]) => ({ accounts: [acct('a', 'Ann'), acct('b', 'Ben'), acct('c', 'Cy')], statuses, notification_groups: groups });
  test('reads groups with their people and post', () => {
    const [g] = fromGroupedNotifications(page([{ group_key: 'page-1', notifications_count: 3, type: 'favourite', sample_account_ids: ['a', 'b', 'c'], status_id: 's1', latest_page_notification_at: '2026-11-16T00:00:00Z' }]));
    expect(g).toMatchObject({ key: 'page-1', type: 'favourite', count: 3, verb: 'liked your post', post: { id: 's1', text: 'My post' } });
    expect(g.people.map(p => p.name)).toEqual(['Ann', 'Ben', 'Cy']);
  });
  test('joins groups on the same post across pages; mentions stay one each', () => {
    const one = fromGroupedNotifications(page([{ group_key: 'page-1', notifications_count: 2, type: 'favourite', sample_account_ids: ['a', 'b'], status_id: 's1' }, { group_key: 'ungrouped-2', type: 'mention', sample_account_ids: ['a'], status_id: 's1' }]));
    const two = fromGroupedNotifications(page([{ group_key: 'page-9', notifications_count: 2, type: 'favourite', sample_account_ids: ['b', 'c'], status_id: 's1' }, { group_key: 'ungrouped-10', type: 'mention', sample_account_ids: ['b'], status_id: 's1' }]));
    const merged = mergeNoticeGroups([...one, ...two]);
    expect(merged.map(g => g.type)).toEqual(['favourite', 'mention', 'mention']);
    expect(merged[0].count).toBe(4);
    expect(merged[0].people.map(p => p.name)).toEqual(['Ann', 'Ben', 'Cy']);
  });
  test('words a group as Mastodon and Bluesky do', () => {
    const p = (name: string) => ({ name });
    expect(groupSentence({ people: [p('Ann')], count: 1, verb: 'liked your post' })).toEqual({ names: 'Ann', rest: 'liked your post' });
    expect(groupSentence({ people: [p('Ann'), p('Ben')], count: 2, verb: 'x' }).names).toBe('Ann and Ben');
    expect(groupSentence({ people: [p('Ann'), p('Ben')], count: 3, verb: 'x' }).names).toBe('Ann, Ben and 1 other');
    expect(groupSentence({ people: [p('Ann'), p('Ben')], count: 7, verb: 'x' }).names).toBe('Ann, Ben and 5 others');
    expect(groupSentence({ people: [], count: 4, verb: 'x' }).names).toBe('4 people');
  });
});
