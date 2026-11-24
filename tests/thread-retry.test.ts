import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { CHECK_MS, nextReadIn } from '../src/lib/thread-live';

describe('an open conversation that did not load whole', () => {
  test('is read again after 4 s, then 12 s, then at the usual pace', () => {
    expect(nextReadIn(0)).toBe(CHECK_MS);
    expect(nextReadIn(1)).toBe(4_000);
    expect(nextReadIn(2)).toBe(12_000);
    expect(nextReadIn(3)).toBe(CHECK_MS);
    expect(nextReadIn(9)).toBe(CHECK_MS);
  });

  test('a post that is gone is not retried quickly; a timeout says Fedizen is slow', () => {
    const hook = readFileSync('src/components/social/useThread.ts', 'utf8');
    expect(hook).toMatch(/r\.error && r\.error !== 'not-found' \? failures\.current \+ 1 : 0/);
    const server = readFileSync('src/lib/fedizen.functions.ts', 'utf8');
    expect(server).toMatch(/r\.failure === 'unreachable'/);
    expect(server).toMatch(/slow\(ctx\) \? \{ slow: true as const \}/);
  });
});
