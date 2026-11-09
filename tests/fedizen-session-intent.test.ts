import { describe, expect, test } from 'bun:test';
import { assertFedizenSessionIntent } from '../src/lib/fedizen-feed';

describe('Fedizen operations must match the authenticated Atlas identity', () => {
  test('allows the exact signed-in account to operate on its own connection', () => {
    expect(() => assertFedizenSessionIntent(
      'af405a8b-a00c-45b2-b611-de84b387159f',
      'af405a8b-a00c-45b2-b611-de84b387159f',
    )).not.toThrow();
  });

  test.each([
    ['af405a8b-a00c-45b2-b611-de84b387159f', 'cfb302b5-bb98-4334-818b-ea4c84821fe2'],
    ['', 'cfb302b5-bb98-4334-818b-ea4c84821fe2'],
    ['af405a8b-a00c-45b2-b611-de84b387159f', ''],
    ['ALICE', 'alice'],
  ])('rejects requests started under a different Atlas account %#', (expected, actual) => {
    expect(() => assertFedizenSessionIntent(expected, actual)).toThrow('Atlas session changed');
  });

  test('mismatch errors must never disclose either account identifier', () => {
    const expected = 'confidential-expected-user';
    const actual = 'confidential-actual-user';
    try {
      assertFedizenSessionIntent(expected, actual);
      throw Error('expected rejection');
    } catch (error) {
      const message = String(error);
      expect(message).not.toContain(expected);
      expect(message).not.toContain(actual);
    }
  });
});
