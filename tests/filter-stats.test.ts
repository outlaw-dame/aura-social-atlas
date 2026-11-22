import { beforeEach, describe, expect, test } from 'bun:test';
import { countLabel, filteredCounts, forgetFilterStats, recordFiltered, resetFilterStats, totalLabel } from '../src/lib/filter-stats';

const DAY = 86_400_000;
beforeEach(() => resetFilterStats());

describe('How much each keyword filter caught', () => {
  test('counts each post once per filter, per account', () => {
    const now = Date.now();
    recordFiltered('u1', 'f1', 'p1', now);
    recordFiltered('u1', 'f1', 'p1', now);
    recordFiltered('u1', 'f1', 'p2', now);
    recordFiltered('u1', 'f2', 'p1', now);
    expect(filteredCounts('u1', now)).toEqual(new Map([['f1', 2], ['f2', 1]]));
    expect(filteredCounts('u2', now).size).toBe(0);
  });
  test('only the last 30 days count', () => {
    const now = Date.now();
    recordFiltered('u1', 'f1', 'old', now - 31 * DAY);
    recordFiltered('u1', 'f1', 'new', now - 2 * DAY);
    expect(filteredCounts('u1', now).get('f1')).toBe(1);
  });
  test('a removed filter’s count is forgotten', () => {
    recordFiltered('u1', 'f1', 'p1');
    forgetFilterStats('u1', 'f1');
    expect(filteredCounts('u1').get('f1')).toBeUndefined();
  });
  test('says it plainly', () => {
    expect(countLabel(0)).toBe('Nothing filtered in the last 30 days');
    expect(countLabel(1)).toBe('Filtered 1 post in the last 30 days');
    expect(countLabel(12)).toBe('Filtered 12 posts in the last 30 days');
    expect(totalLabel([{ id: 'a' }, { id: 'b' }], new Map([['a', 2], ['b', 3]]))).toBe('Your filters caught 5 posts in the last 30 days, counted on this device as you read.');
  });
});
