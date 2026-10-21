import { describe, test } from 'node:test';
import { strictEqual } from 'node:assert';
import { networkBrands, networkBrand } from './network-brands.ts';

describe('network brands', () => {
  test('uses the official Bluesky Blue #0085FF', () => {
    strictEqual(networkBrands.Bluesky.color, '#0085FF');
  });
  test('uses the official Mastodon Purple #6364FF', () => {
    strictEqual(networkBrands.Mastodon.color, '#6364FF');
  });
  test('uses the Podcast Index red #F90000 for Podcasting 2.0', () => {
    strictEqual(networkBrands.Podcasts.color, '#F90000');
  });
  test('returns a brand for Bluesky, Mastodon and Podcasts but not RSS', () => {
    strictEqual(networkBrand('Bluesky')?.label, 'Bluesky');
    strictEqual(networkBrand('Mastodon')?.label, 'Mastodon');
    strictEqual(networkBrand('Podcasts')?.label, 'Podcasting 2.0');
    strictEqual(networkBrand('RSS'), null);
  });
});
