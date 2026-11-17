import { describe, test } from 'node:test';
import { deepStrictEqual, strictEqual } from 'node:assert';
import { allPosts, chatItems, flatReplies, participantsOf, readMarks, subjectOf, unreadIn, writeMark, type KV } from '../src/lib/conversation';
import { buildThread } from '../src/lib/thread';
import type { FedizenPost } from '../src/lib/fedizen-feed';

const at = (min: number) => new Date(Date.UTC(2026, 10, 17, 12, min)).toISOString();
const post = (id: string, who: string, min: number, parent?: string, text = id): FedizenPost => ({
  id, statusId: id, author: who, handle: `@${who}@x.example`, paragraphs: [text], url: `https://x.example/${id}`, date: at(min), ...(parent ? { replyTo: { statusId: parent } } : {}),
});

describe('prototype B: a thread read as one conversation', () => {
  const root = post('r', 'ann', 0, undefined, 'Where should the group meet this weekend? Somewhere near the river, ideally with seats for twelve.');
  const f = post('f', 'bob', 2, 'r');
  const a = post('a', 'cat', 3, 'f'), b = post('b', 'cat', 4, 'f'), c = post('c', 'dan', 20, 'r');
  const t = buildThread(f, [root], [a, b, c]);

  test('every post once, oldest first', () => {
    deepStrictEqual(allPosts(t).map(p => p.statusId), ['r', 'f', 'a', 'b', 'c']);
  });
  test('a subject from the first post, cut at a word', () => {
    strictEqual(subjectOf(root, 40), 'Where should the group meet this…');
    strictEqual(subjectOf(post('x', 'eve', 0, undefined, 'Short')), 'Short');
  });
  test('messages share a header within five minutes; a reply to an earlier message names it; New before the first unread', () => {
    const items = chatItems(allPosts(t), 'f', Date.parse(at(5)), Date.parse(at(30)));
    const msgs = items.filter(i => i.t === 'msg');
    deepStrictEqual(msgs.map(m => m.t === 'msg' && [m.key, m.first, m.parent?.statusId]), [['r', true, undefined], ['f', true, undefined], ['a', true, undefined], ['b', false, undefined], ['c', true, 'r']]);
    deepStrictEqual(items.map(i => i.t), ['day', 'msg', 'msg', 'msg', 'msg', 'new', 'msg']);
  });
  test("unread doesn't count your own; participants most active first", () => {
    strictEqual(unreadIn(allPosts(t), Date.parse(at(2)), p => p.author === 'cat'), 1);
    deepStrictEqual(participantsOf(allPosts(t)).map(x => [x.post.author, x.count]), [['cat', 2], ['ann', 1], ['bob', 1], ['dan', 1]]);
  });
});

describe('prototype A: flat replies', () => {
  test('oldest first, naming the post answered when it is not the opened one', () => {
    const f = post('f', 'ann', 0);
    const t = buildThread(f, [], [post('a', 'bob', 1, 'f'), post('b', 'cat', 2, 'a'), post('c', 'dan', 3, 'f')]);
    deepStrictEqual(flatReplies(t).map(r => [r.post.statusId, r.parent?.statusId]), [['a', undefined], ['b', 'a'], ['c', undefined]]);
  });
});

describe('read positions and mutes on this device', () => {
  test('merge per conversation; survive bad storage', () => {
    const mem = new Map<string, string>();
    const kv: KV = { getItem: k => mem.get(k) ?? null, setItem: (k, v) => void mem.set(k, v) };
    writeMark('r', { lastRead: 5, seenAt: 1 }, kv);
    writeMark('r', { muted: true }, kv);
    deepStrictEqual(readMarks(kv), { r: { lastRead: 5, seenAt: 1, muted: true } });
    mem.set('atlas.proto.conversations', '{not json');
    deepStrictEqual(readMarks(kv), {});
    deepStrictEqual(readMarks(null), {});
  });
});
