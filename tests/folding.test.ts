import { describe, test } from 'node:test';
import { deepStrictEqual, ok, strictEqual } from 'node:assert';
import { buildThread } from '../src/lib/thread';
import { replyFaces } from '../src/lib/folding';
import type { FedizenPost } from '../src/lib/fedizen-feed';

let n = 0;
const post = (id: string, who: string, parent?: string, extra: Partial<FedizenPost> = {}): FedizenPost => ({
  id, statusId: id, author: who, handle: `@${who}@x.example`, paragraphs: ['x'.repeat(10)], url: `https://x.example/${id}`,
  date: new Date(Date.UTC(2026, 0, 1, 0, 0, n++)).toISOString(), ...(parent ? { replyTo: { statusId: parent } } : {}), ...extra,
});

test("a summary's faces are the direct repliers, once each, at most three", () => {
  n = 0;
  const f = post('f', 'ann');
  const t = buildThread(f, [], [post('r', 'bob', 'f'), post('r1', 'cat', 'r'), post('r2', 'cat', 'r'), post('r3', 'dan', 'r1'), post('r4', 'eve', 'r'), post('r5', 'fay', 'r'), post('r6', 'gus', 'r')]);
  deepStrictEqual(replyFaces(t.replies[0]).map(p => p.author), ['cat', 'eve', 'fay']);
});

describe('Atlas folding', () => {
  const { atlasFolds, postHeight, reasonWords } = require('../src/lib/folding') as typeof import('../src/lib/folding');
  const env = (wants: (p: FedizenPost) => 'new' | 'following' | 'mentions' | 'author' | 'mine' | undefined = () => undefined, viewportH = 800) => ({ viewportH, width: 500, wants });
  const big = () => {
    n = 0;
    const f = post('f', 'ann');
    const longs = Array.from({ length: 6 }, (_, i) => post(`h${i}`, `p${i}`, 'heavy', { paragraphs: ['y'.repeat(600)] }));
    const filler = Array.from({ length: 8 }, (_, i) => post(`z${i}`, 'zed', 'f', { paragraphs: ['y'.repeat(400)] }));
    return buildThread(f, [], [post('heavy', 'bob', 'f'), ...longs, post('light', 'cat', 'f'), post('l1', 'dan', 'light'), ...filler]);
  };

  test('a set folds when it would take more than three quarters of the window; small ones stay open', () => {
    const folds = atlasFolds(big(), env());
    strictEqual(folds.get('heavy')!.open, false);
    strictEqual(folds.get('light')!.open, true);
    strictEqual(folds.get('heavy')!.total, 6);
  });

  test('a taller window keeps more open; a conversation that fits in one and a half windows is all open', () => {
    strictEqual(atlasFolds(big(), env(undefined, 4000)).get('heavy')!.open, true);
    n = 0;
    const f = post('f', 'ann');
    const t = buildThread(f, [], [post('r', 'bob', 'f'), post('r1', 'cat', 'r')]);
    strictEqual(atlasFolds(t, env(undefined, 300)).get('r')!.open, true);
  });

  test('never folds a set holding something the reader would want, and says what', () => {
    const t = big();
    const folds = atlasFolds(t, env(p => (p.statusId === 'h3' ? 'new' : p.statusId === 'h4' ? 'following' : undefined)));
    const heavy = folds.get('heavy')!;
    strictEqual(heavy.open, true);
    deepStrictEqual(heavy.reasons, { new: 1, following: 1 });
    deepStrictEqual(reasonWords(heavy.reasons), ['1 new', 'someone you follow']);
  });

  test('height: media at its drawn size, more lines on a narrow screen', () => {
    const p = post('a', 'ann', undefined, { paragraphs: ['y'.repeat(300)] });
    ok(postHeight(p, 300) > postHeight(p, 700));
    const wide = post('b', 'ann', undefined, { image: 'i', imageSize: { w: 1000, h: 500 } });
    const tall = post('c', 'ann', undefined, { image: 'i', imageSize: { w: 500, h: 2000 } });
    ok(postHeight(tall, 500) > postHeight(wide, 500));
    ok(postHeight(tall, 500) <= 44 + 22 + 320 + 12 + 96);
  });
});

test('calibration: the median of drawn over estimated, held between 0.6 and 2, 1 with too little to go on', () => {
  const { calibration } = require('../src/lib/folding') as typeof import('../src/lib/folding');
  strictEqual(calibration([[120, 100], [130, 100], [500, 100]]), 1.3);
  strictEqual(calibration([[100, 100], [140, 100]]), 1);
  strictEqual(calibration([[10, 100], [10, 100], [10, 100]]), 0.6);
  strictEqual(calibration([[900, 100], [900, 100], [900, 100], [900, 100]]), 2);
});
