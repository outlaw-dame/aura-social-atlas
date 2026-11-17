import { describe, expect, test } from 'bun:test';
import { dot, nearest, normalize, truncate } from '../src/lib/semantic/vectors';

describe('Semantic index vectors', () => {
  test('normalized vectors are unit length; a zero vector stays zero', () => {
    const v = normalize([3, 4]);
    expect(v[0]).toBeCloseTo(0.6); expect(v[1]).toBeCloseTo(0.8);
    expect([...normalize([0, 0])]).toEqual([0, 0]);
  });
  test('a Matryoshka cut keeps the leading numbers and normalizes again', () => {
    const t = truncate([3, 4, 100, 100], 2);
    expect(t.length).toBe(2); expect(t[0]).toBeCloseTo(0.6);
  });
  test('vectors of different models (sizes) never match', () => {
    expect(dot(normalize([1, 0]), normalize([1, 0, 0]))).toBe(0);
  });
  test('nearest returns the best k at or above the floor, best first', () => {
    const items = [[1, 0], [0.9, 0.1], [0, 1], [-1, 0]].map((v, i) => ({ id: i, vec: normalize(v) }));
    const hits = nearest(normalize([1, 0]), items, 2, 0.5);
    expect(hits.map(h => h.item.id)).toEqual([0, 1]);
    expect(nearest(normalize([1, 0]), items, 5, 0.5)).toHaveLength(2);
  });
});
