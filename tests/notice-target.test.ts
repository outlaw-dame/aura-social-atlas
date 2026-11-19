import { describe, expect, test } from 'bun:test';
import { FILTER_TYPES, combineMultiPost, fromGroupedNotifications, fromNotifications, groupSentence, inFilter, isUnreadGroup, newerId, noticeLabel, replyKind } from '../src/lib/fedizen-feed';
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

describe('Atlas reads more than Mastodon shows (Bluesky-style Activity)', () => {
  const acct = (id: string, name: string) => ({ id, display_name: name, acct: `${name.toLowerCase()}@example.social`, url: `https://example.social/@${name.toLowerCase()}` });
  const page = (groups: object[], statuses: object[]) => ({ accounts: [acct('a', 'Ann'), acct('b', 'Ben')], statuses, notification_groups: groups });

  test('a reply to you is a reply, whether Mastodon sends it as a mention or Bonfire as a status', () => {
    const st = [{ id: 's1', content: '<p>Nice</p>', in_reply_to_id: 'mine', in_reply_to_account_id: 'me' }];
    const [m] = fromGroupedNotifications(page([{ group_key: 'g', type: 'mention', sample_account_ids: ['a'], status_id: 's1' }], st), 'me');
    const [s] = fromGroupedNotifications(page([{ group_key: 'g', type: 'status', sample_account_ids: ['a'], status_id: 's1' }], st), 'me');
    expect([m.type, m.verb]).toEqual(['reply', 'replied to you']);
    expect([s.type, s.verb]).toEqual(['reply', 'replied to you']);
    expect(m.status?.paragraphs).toEqual(['Nice']);
  });
  test('Bonfire’s status that is not a reply is a new post; one replying elsewhere says so', () => {
    expect(replyKind('status', { in_reply_to_id: null })).toEqual({ type: 'status' });
    expect(replyKind('status', { in_reply_to_id: 'x', in_reply_to_account_id: 'other' }, 'me')).toEqual({ type: 'reply', verb: 'replied in a conversation' });
    expect(replyKind('status', { in_reply_to_id: 'x', in_reply_to_account_id: 'other' })).toEqual({ type: 'reply', verb: 'replied' });
    expect(replyKind('mention', { in_reply_to_id: 'x', in_reply_to_account_id: 'other' }, 'me')).toEqual({ type: 'mention' });
    expect(noticeLabel({ type: 'status', verb: 'posted' })).toBe('New post');
    expect(noticeLabel({ type: 'quote', verb: 'quoted your post' })).toBe('Quoted your post');
  });
  test('keeps people’s Fedizen ids, the newest notification, your post’s picture, and a post that’s gone', () => {
    const [g, gone] = fromGroupedNotifications(page([
      { group_key: 'g1', type: 'favourite', sample_account_ids: ['a', 'b'], status_id: 's1', most_recent_notification_id: 42 },
      { group_key: 'g2', type: 'favourite', sample_account_ids: ['a'], status_id: 'deleted' },
    ], [{ id: 's1', content: '<p>Mine</p>', media_attachments: [{ type: 'image', preview_url: 'https://example.social/p.jpg' }] }]));
    expect(g.people.map(p => p.id)).toEqual(['a', 'b']);
    expect(g.latestId).toBe('42');
    expect(g.post?.image).toBe('https://example.social/p.jpg');
    expect(g.status).toBeUndefined();
    expect(gone.gone).toBe(true);
    expect(gone.post).toBeUndefined();
  });
  test('one person’s likes on several posts within a day become one row', () => {
    const like = (key: string, post: string, date: string) => ({ key, type: 'favourite', count: 1, date, people: [{ name: 'Ann', acct: 'ann@x.social' }], verb: 'liked your post', post: { id: post, text: post } });
    const out = combineMultiPost([like('1', 'p1', '2026-11-18T10:00:00Z'), like('2', 'p2', '2026-11-18T08:00:00Z'), like('3', 'p3', '2026-11-16T08:00:00Z')]);
    expect(out).toHaveLength(2);
    expect(out[0].posts?.map(p => p.id)).toEqual(['p1', 'p2']);
    expect(out[0].verb).toBe('liked 2 of your posts');
    expect(groupSentence(out[0]).names).toBe('Ann');
    expect(noticeTarget(out[0])).toEqual({ kind: 'posts', posts: [{ id: 'p1', text: 'p1' }, { id: 'p2', text: 'p2' }] });
  });
  test('unread is newer than the marker, for Mastodon’s numeric ids and Bonfire’s ULIDs', () => {
    expect(newerId('100', '99')).toBe(true);
    expect(newerId('01JB0000000000000000000002', '01JB0000000000000000000001')).toBe(true);
    expect(isUnreadGroup({ latestId: '99' }, '100')).toBe(false);
    expect(isUnreadGroup({ latestId: '101' }, '100')).toBe(true);
    expect(isUnreadGroup({ latestId: '101' }, null)).toBe(false);
  });
  test('tabs keep their kinds; People you follow keeps rows with someone you follow', () => {
    const g = (type: string, ids: string[]) => ({ key: type, type, count: 1, people: ids.map(id => ({ name: id, id })), verb: '' });
    expect(['reply', 'mention', 'quote', 'status'].map(t => inFilter(g(t, []), 'replies'))).toEqual([true, true, true, false]);
    expect(inFilter(g('follow', []), 'follows')).toBe(true);
    expect(inFilter(g('favourite', ['a', 'b']), 'following', new Set(['b']))).toBe(true);
    expect(inFilter(g('favourite', ['a']), 'following', new Set(['b']))).toBe(false);
    expect(FILTER_TYPES.replies).toEqual(['mention', 'status', 'quote']);
  });
});
