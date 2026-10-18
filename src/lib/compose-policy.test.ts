import { describe, test } from 'node:test';
import { strictEqual } from 'node:assert';
import { isComposeVisible } from './compose-policy';

describe('Compose visibility', () => {
  test('Compose is available on mobile without enabling AI', () => {
    strictEqual(isComposeVisible(true, false, false), true);
  });
  test('mobile Compose hides during scrolling', () => {
    strictEqual(isComposeVisible(true, true, false), false);
  });
  test('mobile Compose returns after scrolling stops', () => {
    strictEqual(isComposeVisible(true, false, false), true);
  });
  test('an open composer remains available while scrolling', () => {
    strictEqual(isComposeVisible(true, true, true), true);
  });
  test('desktop Compose remains visible while scrolling', () => {
    strictEqual(isComposeVisible(false, true, false), true);
  });
});