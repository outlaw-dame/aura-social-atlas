import { describe, test } from 'node:test';
import { deepStrictEqual, strictEqual } from 'node:assert';
import { buildThread } from '../src/lib/thread';
import type { FedizenPost } from '../src/lib/fedizen-feed';

let n = 0;
const post = (id: string, who: string, parent?: string, extra: Partial<FedizenPost> = {}): FedizenPost => ({
  id, statusId: id, author: who, handle: `@${who}@x.example`, paragraphs: [id], url: `https://x.example/${id}`,
  date: new Date(Date.UTC(2026, 0, 1, 0, 0, n++)).toISOString(), ...(parent ? { replyTo: { statusId: parent } } : {}), ...extra,
});
const ids = (list: { post: FedizenPost }[] | FedizenPost[]) => list.map(x => ('post' in x ? x.post : x).statusId);

describe('a conversation, arranged', () => {
  test('ancestors oldest first; a missing parent is noticed; a self-thread above reads as one', () => {
    n = 0;
    const a1 = post('a1', 'ann'), a2 = post('a2', 'ann', 'a1'), f = post('f', 'ann', 'a2');
    const t = buildThread(f, [a2, a1], []);
    deepStrictEqual(ids(t.ancestors), ['a1', 'a2']);
    strictEqual(t.selfThread, true);
    strictEqual(t.missingParent, false);
    const lone = buildThread(post('g', 'bob', 'gone'), [], []);
    strictEqual(lone.missingParent, true);
    strictEqual(buildThread(post('h', 'bob', 'a2'), [a1, a2], []).selfThread, false);
  });

  test("the author's follow-ups come straight after the post; replies to them say which part they answer", () => {
    n = 0;
    const f = post('f', 'ann');
    const c1 = post('c1', 'ann', 'f'), r1 = post('r1', 'bob', 'f'), c2 = post('c2', 'ann', 'c1'), r2 = post('r2', 'cat', 'c1');
    const t = buildThread(f, [], [r1, c2, r2, c1]);
    deepStrictEqual(ids(t.continuation), ['c1', 'c2']);
    deepStrictEqual(t.replies.map(r => [r.post.statusId, r.part]), [['r1', undefined], ['r2', 2]]);
    strictEqual(t.total, 4);
  });

  test('replies nest by parent; orphans hang under the post; cycles and duplicates are ignored', () => {
    n = 0;
    const f = post('f', 'ann');
    const r1 = post('r1', 'bob', 'f'), r11 = post('r11', 'cat', 'r1'), r111 = post('r111', 'bob', 'r11');
    const orphan = post('o', 'dan', 'unknown');
    const loopA = post('la', 'eve', 'lb'), loopB = post('lb', 'eve', 'la');
    const t = buildThread(f, [f], [r1, r11, r111, orphan, r1, loopA, loopB]);
    deepStrictEqual(ids(t.replies), ['r1', 'o']);
    deepStrictEqual(ids(t.replies[0].replies), ['r11']);
    deepStrictEqual(ids(t.replies[0].replies[0].replies), ['r111']);
    strictEqual(t.replies[0].size, 2);
    strictEqual(t.replies[0].replies[0].replies[0].depth, 3);
  });

  test('sorting: the author and the reader first, then Oldest, Newest or Top', () => {
    n = 0;
    const f = post('f', 'ann');
    const old = post('old', 'bob', 'f', { counts: { likes: 0, boosts: 0, replies: 0 } });
    const hot = post('hot', 'cat', 'f', { counts: { likes: 9, boosts: 3, replies: 0 } });
    const mine = post('mine', 'me', 'f');
    const fresh = post('new', 'dan', 'f');
    const order = (sort: 'oldest' | 'newest' | 'top') => ids(buildThread(f, [], [old, hot, mine, fresh], { sort, isMe: p => p.author === 'me' }).replies);
    deepStrictEqual(order('oldest'), ['mine', 'old', 'hot', 'new']);
    deepStrictEqual(order('newest'), ['mine', 'new', 'hot', 'old']);
    deepStrictEqual(order('top'), ['mine', 'hot', 'old', 'new']);
  });
});

describe('what counts as clicking a post', () => {
  const { isPostClick } = require('../src/lib/open-post') as typeof import('../src/lib/open-post');
  const el = (matches: string[], inside = true) => {
    const card = { contains: () => inside } as unknown as Element;
    const target = { closest: (sel: string) => (matches.some(m => sel.split(', ').includes(m)) ? {} : null) } as unknown as Element;
    return { target, currentTarget: card, button: 0 };
  };
  test('plain text opens; links, buttons, media and portals do not', () => {
    strictEqual(isPostClick(el([])), true);
    strictEqual(isPostClick(el(['a'])), false);
    strictEqual(isPostClick(el(['button'])), false);
    strictEqual(isPostClick(el(['video'])), false);
    strictEqual(isPostClick(el(['.atlas-mfm-blur'])), false);
    strictEqual(isPostClick(el([], false)), false);
    strictEqual(isPostClick({ ...el([]), button: 1 }), false);
    strictEqual(isPostClick({ ...el([]), defaultPrevented: true }), false);
  });
});
