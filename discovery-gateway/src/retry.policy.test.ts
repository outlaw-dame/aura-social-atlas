/** Verify the actual pinned Fedify retry policy and Postgres queue contract.
 * No network or clock sleeps: retry delays are inspected deterministically. */
import { describe, expect, test } from 'bun:test';
import { createExponentialBackoffPolicy, type MessageQueue } from '@fedify/fedify';
import { PostgresMessageQueue } from '@fedify/postgres';
import { Temporal } from 'temporal-polyfill';
import type { Sql } from 'postgres';

const context = (attempts: number) => ({
  attempts,
  elapsedTime: Temporal.Duration.from({ seconds: 0 }),
});

describe('Fedify 2.4.5 durable PostgreSQL delivery retry contract', () => {
  test('PostgreSQL queue delegates retry scheduling to Fedify, not two layers', () => {
    const queue: MessageQueue = new PostgresMessageQueue({} as Sql);
    expect(queue.nativeRetrial).not.toBe(true);
  });

  test('non-jittered exponential delays, max-delay cap and exhaustion', () => {
    const p = createExponentialBackoffPolicy({
      initialDelay: { seconds: 1 }, factor: 2,
      maxDelay: { seconds: 5 }, maxAttempts: 5, jitter: false,
    });
    expect(p(context(0))?.total('millisecond')).toBe(1000);
    expect(p(context(1))?.total('millisecond')).toBe(2000);
    expect(p(context(2))?.total('millisecond')).toBe(4000);
    expect(p(context(3))?.total('millisecond')).toBe(5000);
    expect(p(context(4))?.total('millisecond')).toBe(5000);
    expect(p(context(5))).toBeNull();
  });

  test('default Fedify retry count and bounded jitter', () => {
    const defaultPolicy = createExponentialBackoffPolicy();
    for (let attempts = 0; attempts < 10; attempts++) {
      const delay = defaultPolicy(context(attempts));
      const milliseconds = delay?.total('millisecond');
      const base = 1000 * 2 ** attempts;
      expect(milliseconds).toBeNumber();
      expect(milliseconds!).toBeGreaterThanOrEqual(base);
      expect(milliseconds!).toBeLessThanOrEqual(Math.min(base * 2, 12 * 60 * 60 * 1000));
    }
    expect(defaultPolicy(context(10))).toBeNull();
    expect(defaultPolicy(context(11))).toBeNull();
  });

  test('custom high-attempt policy never exceeds max delay', () => {
    const p = createExponentialBackoffPolicy({
      initialDelay: { seconds: 2 }, maxDelay: { minutes: 1 },
      maxAttempts: 20, factor: 3, jitter: false,
    });
    for (let n = 0; n < 20; n++) {
      const duration = p(context(n));
      expect(duration?.total('millisecond')).toBeLessThanOrEqual(60_000);
    }
    expect(p(context(20))).toBeNull();
  });
});
