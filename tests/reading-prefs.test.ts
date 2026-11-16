import { describe, expect, test } from 'bun:test';
import { DEFAULT_READING, parseReading, veilReason } from '../src/lib/reading-prefs';

describe('reading preferences (Mastodon: reading:expand:spoilers, reading:expand:media)', () => {
  test('stored values are read back; anything else falls back to the defaults', () => {
    expect(parseReading(JSON.stringify({ expandWarnings: true, media: 'hide_all' }))).toEqual({ expandWarnings: true, media: 'hide_all', altReminder: true, blurStrangers: false });
    expect(parseReading(JSON.stringify({ expandWarnings: 'yes', media: 'everything' }))).toEqual(DEFAULT_READING);
    expect(parseReading('{not json')).toEqual(DEFAULT_READING);
    expect(parseReading(null)).toEqual(DEFAULT_READING);
  });
  test('by default only media marked sensitive is veiled', () => {
    const d = DEFAULT_READING;
    expect(veilReason(d, null, true)).toBe('The author marked this media as sensitive');
    expect(veilReason(d, null, false)).toBeNull();
  });
  test('show all lifts the author mark; hide all veils everything', () => {
    expect(veilReason({ ...DEFAULT_READING, media: 'show_all' }, null, true)).toBeNull();
    expect(veilReason({ ...DEFAULT_READING, media: 'hide_all' }, null, false)).toBe('Hidden by your media setting');
    expect(veilReason({ ...DEFAULT_READING, media: 'hide_all' }, null, true)).toBe('The author marked this media as sensitive');
  });
  test('a keyword filter that hides media always wins, even under show all', () => {
    expect(veilReason({ ...DEFAULT_READING, media: 'show_all' }, 'Hidden by your filter “gore”', false)).toBe('Hidden by your filter “gore”');
  });
});

describe('blur media from people you don’t follow', () => {
  test('off by default; when on, media from people you don’t follow is veiled even under Show all', () => {
    expect(DEFAULT_READING.blurStrangers).toBe(false);
    const on = { ...DEFAULT_READING, blurStrangers: true };
    expect(veilReason(DEFAULT_READING, null, false, true)).toBeNull();
    expect(veilReason(on, null, false, true)).toBe('From someone you don’t follow');
    expect(veilReason({ ...on, media: 'show_all' }, null, false, true)).toBe('From someone you don’t follow');
    expect(veilReason(on, null, false, false)).toBeNull();
    expect(veilReason(on, null, true, true)).toBe('The author marked this media as sensitive');
    expect(veilReason(on, 'Hidden by your filter “x”', false, true)).toBe('Hidden by your filter “x”');
  });
  test('the switch is read back from storage', () => {
    expect(parseReading(JSON.stringify({ blurStrangers: true })).blurStrangers).toBe(true);
    expect(parseReading(JSON.stringify({ blurStrangers: 'yes' })).blurStrangers).toBe(false);
  });
});
