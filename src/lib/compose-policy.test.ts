import { describe, test } from 'node:test';
import { strictEqual } from 'node:assert';
import { isComposeVisible } from './compose-policy';

describe('Compose visibility', () => {
  test('Compose is available without enabling AI', () => strictEqual(isComposeVisible(false, false), true));
  test('Compose hides while scrolling, on every screen size', () => strictEqual(isComposeVisible(true, false), false));
  test('an open composer remains available while scrolling', () => strictEqual(isComposeVisible(true, true), true));
});
