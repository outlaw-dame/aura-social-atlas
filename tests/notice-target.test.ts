import { describe, expect, test } from 'bun:test';
import { fromGroupedNotifications, fromNotifications } from '../src/lib/fedizen-feed';
import { noticeActionLabel, noticeTarget, singleNoticeTarget } from '../src/lib/notice-target';

const ann = { name: 'Ann', acct: 'ann@example.social', actor: 'https://example.social/users/ann' };
const ben = { name: 'Ben', acct: 'ben@example.social' };
const post = { id: '01JABCDEF', text: 'Hello' };

describe('Where tapping a notification goes', () => {
  test('a notification about a post opens its conversation, whoever did it', () => {
    for (const type of ['mention', 'reply', 'status', 'quote', 'favourite', 'reblog', 'poll', 'update', 'quoted_update'])
      expect(noticeTarget({ type, people: [ann, ben], post })).toEqual({ kind: 'post', statusId: '01JABCDEF' });
  });
  test('a follow opens the person; a group of follows lists them', () => {
    expect(noticeTarget({ type: 'follow', people: [ann] })).toEqual({ kind: 'profile', person: ann });
    expect(noticeTarget({ type: 'follow_request', people: [ann] })).toEqual({ kind: 'profile', person: ann });
    expect(noticeTarget({ type: 'follow', people: [ann, ben] })).toEqual({ kind: 'people', people: [ann, ben] });
  });
  test('people Atlas can’t open are left out', () => {
    expect(noticeTarget({ type: 'follow', people: [{ name: 'Nobody' }, ann] })).toEqual({ kind: 'profile', person: ann });
    expect(noticeTarget({ type: 'follow', people: [{ name: 'Nobody' }] })).toBeNull();
  });
  test('a collection notification opens the collection, only from a Mastodon collection page', () => {
    expect(noticeTarget({ type: 'added_to_collection', people: [ann], collection: 'https://example.social/collections/42' })).toEqual({ kind: 'collection', link: 'https://example.social/collections/42' });
    expect(noticeTarget({ type: 'added_to_collection', people: [ann], collection: 'javascript:alert(1)' })).toEqual({ kind: 'profile', person: ann });
  });
  test('reports, moderation warnings and severed follows go nowhere in Atlas', () => {
    for (const type of ['admin.report', 'moderation_warning', 'severed_relationships']) expect(noticeTarget({ type, people: [ann], post })).toBeNull();
  });
  test('a post id that isn’t one is not opened', () => {
    expect(noticeTarget({ type: 'mention', people: [ann], post: { id: '../../admin', text: '' } })).toEqual({ kind: 'profile', person: ann });
  });
  test('says what it opens', () => {
    expect(noticeActionLabel({ kind: 'post', statusId: 'x' })).toBe('Open the conversation');
    expect(noticeActionLabel({ kind: 'people', people: [] })).toBe('See who');
  });
});

describe('Notifications keep what they point at', () => {
  test('single notifications keep the post’s id', () => {
    const [n] = fromNotifications([{ id: 'n1', type: 'mention', account: { id: 'a', display_name: 'Ann', acct: 'ann@example.social', url: 'https://example.social/@ann' }, status: { id: 's9', content: '<p>Hi</p>' } }]);
    expect(n.statusId).toBe('s9');
    expect(singleNoticeTarget(n)).toEqual({ kind: 'post', statusId: 's9' });
    const [f] = fromNotifications([{ id: 'n2', type: 'follow', account: { id: 'a', display_name: 'Ann', acct: 'ann@example.social', url: 'https://example.social/@ann' } }]);
    expect(singleNoticeTarget(f)).toMatchObject({ kind: 'profile', person: { name: 'Ann', acct: 'ann@example.social' } });
  });
  test('grouped notifications keep a Mastodon 4.6 collection’s page, and words new kinds', () => {
    const [g, q] = fromGroupedNotifications({
      accounts: [{ id: 'a', display_name: 'Ann', acct: 'ann@example.social' }],
      statuses: [{ id: 's1', content: '<p>Mine</p>' }],
      notification_groups: [
        { group_key: 'ungrouped-1', type: 'added_to_collection', sample_account_ids: ['a'], collection: { url: 'https://example.social/collections/7' } },
        { group_key: 'ungrouped-2', type: 'quote', sample_account_ids: ['a'], status_id: 's1' },
      ],
    });
    expect(g.collection).toBe('https://example.social/collections/7');
    expect(q.verb).toBe('quoted your post');
    expect(noticeTarget(q)).toEqual({ kind: 'post', statusId: 's1' });
  });
});
