import { describe, test } from 'node:test';
import { strictEqual } from 'node:assert';
import { networkBrands, networkBrand } from './networks';

describe('network brands', () => {
  test('uses the official Bluesky Blue #0085FF', () => {
    strictEqual(networkBrands.Bluesky.color, '#0085FF');
  });
  test('uses the official Mastodon Purple #6364FF', () => {
    strictEqual(networkBrands.Mastodon.color, '#6364FF');
  });
  test('returns a brand for Bluesky and Mastodon but not RSS', () => {
    strictEqual(networkBrand('Bluesky')?.label, 'Bluesky');
    strictEqual(networkBrand('Mastodon')?.label, 'Mastodon');
    strictEqual(networkBrand('RSS'), null);
  });
});
