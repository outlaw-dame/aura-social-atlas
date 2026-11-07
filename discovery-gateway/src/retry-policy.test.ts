/**
 * Pin runtime semantics of Fedify's actual exponential retry implementation.
 * Tests the dependency, not a hand-written approximation of its algorithm.
 */
import { describe, expect, test } from 'bun:test';
import { createExponentialBackoffPolicy } from '@fedify/fedify';
import { PostgresMessageQueue } from '@fedify/postgres';
import { Temporal } from 'temporal-polyfill';

const elapsedTime = Temporal.Duration.from({ seconds: 0 });

describe('Fedify 2.4.5 retry policy and PostgreSQL queue contract', () => {
  test('PostgreSQL queue delegates failures to Fedify instead of double-retrying', () => {
    // A backend-native retry layered under the middleware retry would risk
    // exponential multiplication of attempts and duplicate delivery.
    expect((new PostgresMessageQueue({} as never) as unknown as { nativeRetrial?: boolean }).nativeRetrial).not.toBe(true);
  });

  test('retry delay is exponentially increasing, capped, and finally exhausted', () => {
    const policy = createExponentialBackoffPolicy({
      initialDelay: { seconds: 1 },
      factor: 2,
      maxDelay: { seconds: 5 },
      maxAttempts: 6,
      jitter: false,
    });
    const delays: number[] = [];
    for (const attempts of [1, 2, 3, 4, 5]) {
      const delay = policy({ attempts, elapsedTime });
      expect(delay).not.toBeNull();
      const ms = delay!.total({ unit: 'milliseconds' });
      expect(Number.isFinite(ms)).toBe(true);
      expect(ms).toBeGreaterThan(0);
      expect(ms).toBeLessThanOrEqual(5_000);
      delays.push(ms);
    }
    expect(delays.every((x, i) => i === 0 || x >= delays[i - 1]!)).toBe(true);
    expect(delays.some((x, i) => i > 0 && x > delays[i - 1]!)).toBe(true);
    expect(delays[delays.length - 1]).toBe(5_000);
    expect(policy({ attempts: 6, elapsedTime })).toBeNull();
    expect(policy({ attempts: 7, elapsedTime })).toBeNull();
  });

  test('default jitter remains bounded by the configured delay cap', () => {
    const policy = createExponentialBackoffPolicy({
      initialDelay: { seconds: 1 }, factor: 2,
      maxDelay: { seconds: 3 }, maxAttempts: 10, jitter: true,
    });
    for (let i = 0; i < 48; i++) {
      const delay = policy({ attempts: 4, elapsedTime });
      expect(delay).not.toBeNull();
      const ms = delay!.total({ unit: 'milliseconds' });
      expect(ms).toBeGreaterThanOrEqual(0);
      expect(ms).toBeLessThanOrEqual(3_000);
    }
  });
});
