import { describe, expect, test } from 'bun:test';
import { createExponentialBackoffPolicy } from '@fedify/fedify';
import { Temporal } from 'temporal-polyfill';

describe('pinned Fedify retry behavior (no application-level duplicate retry)', () => {
  const elapsedTime = Temporal.Duration.from({ seconds: 0 });
  const noJitter = createExponentialBackoffPolicy({
    initialDelay: { milliseconds: 100 },
    factor: 2,
    maxDelay: { milliseconds: 800 },
    maxAttempts: 5,
    jitter: false,
  });

  test('uses exponential delays, caps retries, and terminates', () => {
    const delays = [1, 2, 3, 4].map(attempts =>
      noJitter({ attempts, elapsedTime })?.total('milliseconds') ?? null);
    expect(delays).toEqual([100, 200, 400, 800]);
    expect(noJitter({ attempts: 5, elapsedTime })).toBeNull();
    expect(noJitter({ attempts: 6, elapsedTime })).toBeNull();
  });

  test('jitter delays are finite and bounded by the configured maximum', () => {
    const jittered = createExponentialBackoffPolicy({
      initialDelay: { seconds: 1 },
      factor: 2, maxDelay: { seconds: 12 }, maxAttempts: 10, jitter: true,
    });
    for (let attempt = 1; attempt < 10; attempt++) {
      for (let sample = 0; sample < 20; sample++) {
        const duration = jittered({ attempts: attempt, elapsedTime });
        expect(duration).not.toBeNull();
        const ms = duration!.total('milliseconds');
        expect(Number.isFinite(ms)).toBe(true);
        expect(ms).toBeGreaterThanOrEqual(0);
        expect(ms).toBeLessThanOrEqual(12_000);
      }
    }
    expect(jittered({ attempts: 10, elapsedTime })).toBeNull();
  });
});
