import { describe, expect, test } from 'bun:test';
import { canAdd, effectiveSensitive, formatBytes, mediaKind } from '../src/lib/compose-media';
import { fitPixels, MAX_PIXELS } from '../src/lib/prepare-image';

describe('posting with media: the rules Atlas keeps (Mastodon)', () => {
  test('up to four images, or one video on its own', () => {
    expect(canAdd([], 'image')).toBeNull();
    expect(canAdd(['image', 'image', 'image'], 'image')).toBeNull();
    expect(canAdd(['image', 'image', 'image', 'image'], 'image')).toBe('Up to 4 images in a post.');
    expect(canAdd([], 'video')).toBeNull();
    expect(canAdd(['image'], 'video')).toBe('A video goes in a post on its own.');
    expect(canAdd(['video'], 'image')).toBe('A post with a video can’t have other media.');
  });
  test('which files count as images or video', () => {
    expect(mediaKind('image/heic')).toBe('image');
    expect(mediaKind('video/mp4')).toBe('video');
    expect(mediaKind('video/quicktime')).toBeNull();
    expect(mediaKind('application/pdf')).toBeNull();
  });
  test('a content warning marks attached media sensitive; without media nothing is sensitive', () => {
    expect(effectiveSensitive('spoilers', true, false)).toBe(true);
    expect(effectiveSensitive('', true, true)).toBe(true);
    expect(effectiveSensitive('', true, false)).toBe(false);
    expect(effectiveSensitive('spoilers', false, true)).toBe(false);
  });
  test('images are scaled to at most 8.3 megapixels, keeping their shape', () => {
    expect(fitPixels(1200, 800)).toEqual({ w: 1200, h: 800 });
    const big = fitPixels(8064, 6048); // a 48 MP phone photo
    expect(big.w * big.h).toBeLessThanOrEqual(MAX_PIXELS);
    expect(Math.abs(big.w / big.h - 8064 / 6048)).toBeLessThan(0.01);
  });
  test('sizes read naturally', () => {
    expect(formatBytes(5_000_000)).toBe('5 MB');
    expect(formatBytes(20_000_000)).toBe('20 MB');
    expect(formatBytes(800)).toBe('1 KB');
  });
});
