import { describe, it, expect } from 'vitest';
import { networkBrands, networkBrand } from './networks';

describe('network brands', () => {
  it('uses the official Bluesky Blue #0085FF', () => {
    expect(networkBrands.Bluesky.color).toBe('#0085FF');
  });
  it('uses the official Mastodon Purple #6364FF', () => {
    expect(networkBrands.Mastodon.color).toBe('#6364FF');
  });
  it('returns a brand for Bluesky and Mastodon but not RSS', () => {
    expect(networkBrand('Bluesky')?.label).toBe('Bluesky');
    expect(networkBrand('Mastodon')?.label).toBe('Mastodon');
    expect(networkBrand('RSS')).toBeNull();
  });
});
