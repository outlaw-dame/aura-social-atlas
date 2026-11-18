import { describe, test } from 'node:test';
import { deepStrictEqual, strictEqual } from 'node:assert';
import { allPosts, flatReplies, participantsOf, readMarks, writeMark, type KV } from '../src/lib/conversation';
import { buildThread } from '../src/lib/thread';
import type { FedizenPost } from '../src/lib/fedizen-feed';

const at = (min: number) => new Date(Date.UTC(2026, 10, 17, 12, min)).toISOString();
const post = (id: string, who: string, min: number, parent?: string, text = id): FedizenPost => ({
  id, statusId: id, author: who, handle: `@${who}@x.example`, paragraphs: [text], url: `https://x.example/${id}`, date: at(min), ...(parent ? { replyTo: { statusId: parent } } : {}),
});

describe('a conversation', () => {
  const root = post('r', 'ann', 0, undefined, 'Where should the group meet this weekend? Somewhere near the river, ideally with seats for twelve.');
  const f = post('f', 'bob', 2, 'r');
  const a = post('a', 'cat', 3, 'f'), b = post('b', 'cat', 4, 'f'), c = post('c', 'dan', 20, 'r');
  const t = buildThread(f, [root], [a, b, c]);

  test('every post once, oldest first', () => {
    deepStrictEqual(allPosts(t).map(p => p.statusId), ['r', 'f', 'a', 'b', 'c']);
  });
  test('participants, most active first', () => {
    deepStrictEqual(participantsOf(allPosts(t)).map(x => [x.post.author, x.count]), [['cat', 2], ['ann', 1], ['bob', 1], ['dan', 1]]);
  });
});

describe('flat replies', () => {
  test('oldest first, naming the post answered when it is not the opened one', () => {
    const f = post('f', 'ann', 0);
    const t = buildThread(f, [], [post('a', 'bob', 1, 'f'), post('b', 'cat', 2, 'a'), post('c', 'dan', 3, 'f')]);
    deepStrictEqual(flatReplies(t).map(r => [r.post.statusId, r.parent?.statusId]), [['a', undefined], ['b', 'a'], ['c', undefined]]);
  });
  test("the author's follow-ups, drawn above the replies, aren't listed again; replies to them are", () => {
    const f = post('f', 'ann', 0);
    const t = buildThread(f, [], [post('c1', 'ann', 1, 'f'), post('x', 'bob', 2, 'c1'), post('y', 'cat', 3, 'f')]);
    deepStrictEqual(t.continuation.map(p => p.statusId), ['c1']);
    deepStrictEqual(flatReplies(t).map(r => [r.post.statusId, r.parent?.statusId]), [['x', 'c1'], ['y', undefined]]);
  });
});

describe('where the reader left off, on this device', () => {
  test('merge per conversation; survive bad storage', () => {
    const mem = new Map<string, string>();
    const kv: KV = { getItem: k => mem.get(k) ?? null, setItem: (k, v) => void mem.set(k, v) };
    writeMark('r', { lastRead: 5, seenAt: 1 }, kv);
    writeMark('r', { opened: 'f' }, kv);
    deepStrictEqual(readMarks(kv), { r: { lastRead: 5, seenAt: 1, opened: 'f' } });
    mem.set('atlas.proto.conversations', '{not json');
    deepStrictEqual(readMarks(kv), {});
    deepStrictEqual(readMarks(null), {});
  });
});

describe('branch colours and thread numbers', () => {
  const { branchesOf, threadNumbers } = require('../src/lib/conversation') as typeof import('../src/lib/conversation');
  test('each top-level reply and everything under it share one colour; the post and follow-ups have none', () => {
    const f = post('f', 'ann', 0);
    const t = buildThread(f, [], [post('c1', 'ann', 1, 'f'), post('a', 'bob', 2, 'f'), post('a1', 'cat', 3, 'a'), post('b', 'dan', 4, 'f')]);
    const b = branchesOf(t);
    deepStrictEqual([b.get('a'), b.get('a1'), b.get('b'), b.get('f'), b.get('c1')], [0, 0, 1, undefined, undefined]);
  });
  test("an author's self-thread is numbered from the first post above", () => {
    const r = post('r', 'ann', 0), f = post('f', 'ann', 1, 'r');
    const t = buildThread(f, [r], [post('c1', 'ann', 2, 'f')]);
    deepStrictEqual([...threadNumbers(t).entries()], [['r', { index: 1, total: 3 }], ['f', { index: 2, total: 3 }], ['c1', { index: 3, total: 3 }]]);
    strictEqual(threadNumbers(buildThread(post('x', 'bob', 0), [], [])).size, 0);
  });
});
