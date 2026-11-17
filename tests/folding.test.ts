import { describe, test } from 'node:test';
import { deepStrictEqual, ok, strictEqual } from 'node:assert';
import { buildThread } from '../src/lib/thread';
import { bonfireFolds, bonfireMoreLabel, phanpyFolds, postWeight, replyFaces } from '../src/lib/folding';
import type { FedizenPost } from '../src/lib/fedizen-feed';

let n = 0;
const post = (id: string, who: string, parent?: string, extra: Partial<FedizenPost> = {}): FedizenPost => ({
  id, statusId: id, author: who, handle: `@${who}@x.example`, paragraphs: ['x'.repeat(10)], url: `https://x.example/${id}`,
  date: new Date(Date.UTC(2026, 0, 1, 0, 0, n++)).toISOString(), ...(parent ? { replyTo: { statusId: parent } } : {}), ...extra,
});
const long = (id: string, who: string, parent: string) => post(id, who, parent, { paragraphs: ['y'.repeat(500)] });

describe("Phanpy's weight (calcStatusWeight)", () => {
  test('text, media, poll options and its card term, over 140', () => {
    strictEqual(postWeight(post('a', 'ann')), (10 + 70) / 140);
    strictEqual(postWeight(post('b', 'ann', undefined, { image: 'i' })), (10 + 140 + 70) / 140);
    // A card with media adds nothing for the card; that is the only case it doesn't.
    strictEqual(postWeight(post('c', 'ann', undefined, { image: 'i', linkTitle: 'l' })), (10 + 140) / 140);
    strictEqual(postWeight(post('d', 'ann', undefined, { poll: ['1', '2', '3'] })), (10 + 105 + 70) / 140);
    strictEqual(postWeight(post('e', 'ann', undefined, { cw: 'cw' })), (12 + 70) / 140);
  });
});

describe('Phanpy folding', () => {
  test('a conversation under 10 posts is all open', () => {
    n = 0;
    const f = post('f', 'ann');
    const t = buildThread(f, [], [long('r', 'bob', 'f'), long('r1', 'cat', 'r'), long('r2', 'dan', 'r')]);
    deepStrictEqual(phanpyFolds(t).get('r'), { open: true, replies: 2, comments: 2 });
  });

  test('past 10, light branches stay open and heavy ones close; a closed set restarts the weight below it', () => {
    n = 0;
    const f = post('f', 'ann');
    const filler = Array.from({ length: 8 }, (_, i) => post(`z${i}`, 'zed', 'f'));
    const t = buildThread(f, [], [
      post('light', 'bob', 'f'), post('l1', 'cat', 'light'), post('l2', 'dan', 'light'),
      long('heavy', 'eve', 'f'), long('h1', 'fay', 'heavy'), long('h2', 'gus', 'heavy'), post('h11', 'hal', 'h1'),
      ...filler,
    ]);
    ok(t.total >= 10);
    const folds = phanpyFolds(t);
    strictEqual(folds.get('light')!.open, true); // 3 × 80/140 ≈ 1.7
    const heavy = folds.get('heavy')!;
    strictEqual(heavy.open, false); // 3 × 570/140 ≈ 12
    strictEqual(heavy.replies, 2);
    strictEqual(heavy.comments, 3);
    // Under a closed set the count starts again from h1 alone: 570/140 + 80/140 ≈ 4.6, so h1's reply is open.
    strictEqual(folds.get('h1')!.open, true);
  });

  test('a single short reply stays open, unless it answers the author', () => {
    n = 0;
    const f = post('f', 'ann');
    const filler = Array.from({ length: 9 }, (_, i) => post(`z${i}`, 'zed', 'f'));
    const t = buildThread(f, [], [post('c', 'ann', 'f'), post('big', 'bob', 'f', { paragraphs: ['y'.repeat(800)] }), post('b1', 'cat', 'big'), post('own', 'ann', 'f', { paragraphs: ['y'.repeat(800)] }), post('o1', 'cat', 'own'), ...filler]);
    strictEqual(phanpyFolds(t).get('big')!.open, true);
    strictEqual(phanpyFolds(t).get('own')!.open, false);
  });
});

describe('Bonfire folding', () => {
  test('folds a reply with 3 or more under it, only in threads of 10 or more', () => {
    n = 0;
    const f = post('f', 'ann');
    const small = buildThread(f, [], [post('r', 'bob', 'f'), post('r1', 'cat', 'r'), post('r2', 'dan', 'r'), post('r3', 'eve', 'r1')]);
    strictEqual(bonfireFolds(small, small.replies[0]), false);
    const filler = Array.from({ length: 8 }, (_, i) => post(`z${i}`, 'zed', 'f'));
    const big = buildThread(f, [], [post('r', 'bob', 'f'), post('r1', 'cat', 'r'), post('r2', 'dan', 'r'), post('r3', 'eve', 'r1'), post('s', 'fay', 'f'), post('s1', 'gus', 's'), ...filler]);
    const by = (k: string) => big.replies.find(x => x.post.statusId === k)!;
    strictEqual(bonfireFolds(big, by('r')), true);
    strictEqual(bonfireFolds(big, by('s')), false);
  });

  test('"N more replies", with + when more sit deeper', () => {
    n = 0;
    const f = post('f', 'ann');
    const t = buildThread(f, [], [post('r', 'bob', 'f'), post('r1', 'cat', 'r'), post('r11', 'dan', 'r1'), post('r12', 'eve', 'r1')]);
    strictEqual(bonfireMoreLabel(t.replies[0]), '1+ more replies');
    strictEqual(bonfireMoreLabel(t.replies[0].replies[0]), '2 more replies');
  });
});

test("a summary's faces are the direct repliers, once each, at most three", () => {
  n = 0;
  const f = post('f', 'ann');
  const t = buildThread(f, [], [post('r', 'bob', 'f'), post('r1', 'cat', 'r'), post('r2', 'cat', 'r'), post('r3', 'dan', 'r1'), post('r4', 'eve', 'r'), post('r5', 'fay', 'r'), post('r6', 'gus', 'r')]);
  deepStrictEqual(replyFaces(t.replies[0]).map(p => p.author), ['cat', 'eve', 'fay']);
});
