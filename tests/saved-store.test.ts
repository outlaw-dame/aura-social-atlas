import { describe, expect, test } from 'bun:test';
import { _savedStoreForTests as store } from '../src/components/social/useFedizenLibrary';

describe('saved state shared across views', () => {
  test('a change made in one view is what every view reads next, and a new account starts empty', () => {
    store.own('user-a');
    let notified = 0;
    const off = store.subscribe(() => { notified++; });
    const before = store.snapshot();
    store.set('01S', { saved: true, pending: true });
    expect(store.snapshot()).not.toBe(before);
    expect(store.snapshot().get('01S')).toEqual({ saved: true, pending: true });
    store.set('01S', { saved: false, pending: false });
    expect(store.snapshot().get('01S')).toEqual({ saved: false, pending: false });
    expect(notified).toBe(2);
    store.own('user-a');
    expect(store.snapshot().get('01S')).toEqual({ saved: false, pending: false });
    store.own('user-b');
    expect(store.snapshot().size).toBe(0);
    off();
  });
});
