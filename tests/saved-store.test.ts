import { describe, expect, test } from 'bun:test';
import { _savedStoreForTests as store } from '../src/components/social/useFedizenLibrary';
import { _reactionStoreForTests as reactions } from '../src/components/social/usePostActions';

describe('saved state shared across views', () => {
  test('a change made in one view is what every view reads next, and a new account starts empty', () => {
    store.own('user-a');
    let notified = 0;
    const off = store.subscribe(() => { notified++; });
    const before = store.snapshot();
    store.set('user-a', '01S', { saved: true, pending: true });
    expect(store.snapshot()).not.toBe(before);
    expect(store.snapshot().get('01S')).toEqual({ saved: true, pending: true });
    store.set('user-a', '01S', { saved: false, pending: false });
    expect(store.snapshot().get('01S')).toEqual({ saved: false, pending: false });
    expect(notified).toBe(2);
    store.own('user-a');
    expect(store.snapshot().get('01S')).toEqual({ saved: false, pending: false });
    store.own('user-b');
    expect(store.snapshot().size).toBe(0);
    off();
  });

  test("a write that lands after the account changed is dropped, for saves and for likes and boosts", () => {
    store.own('user-a');
    store.own('user-b');
    store.set('user-a', '01S', { saved: true, pending: false });
    expect(store.snapshot().size).toBe(0);
    reactions.own('user-a');
    reactions.own('user-b');
    reactions.set('user-a', 'like:01S', { on: true, count: 3, pending: false });
    expect(reactions.snapshot().size).toBe(0);
    reactions.set('user-b', 'like:01S', { on: true, count: 3, pending: false });
    expect(reactions.snapshot().get('like:01S')).toEqual({ on: true, count: 3, pending: false });
  });
});
