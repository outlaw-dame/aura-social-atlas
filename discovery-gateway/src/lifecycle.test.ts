import { describe, expect, test } from 'bun:test';
import { gatewayRole, superviseQueue } from './lifecycle.ts';

describe('gateway process roles and queue supervision', () => {
  test('rejects unexpected roles before any service can start', () => {
    expect(gatewayRole(undefined)).toBe('combined');
    expect(gatewayRole('')).toBe('combined');
    for (const role of ['web', 'worker', 'combined'] as const) expect(gatewayRole(role)).toBe(role);
    for (const invalid of ['WEB', 'test', 'web,worker', ' web ']) expect(() => gatewayRole(invalid)).toThrow();
  });

  test('intended abort drains queue without a fatal callback, and stop is idempotent', async () => {
    const failures: unknown[] = [];
    let started = 0;
    const worker = superviseQueue(signal => new Promise<void>(resolve => {
      started++;
      if (signal.aborted) resolve();
      else signal.addEventListener('abort', () => resolve(), { once: true });
    }), error => { failures.push(error); });
    const first = worker.stop();
    expect(worker.stop()).toBe(first);
    await first;
    expect(started).toBe(1);
    expect(failures).toEqual([]);
  });

  test('reports fatal worker rejection rather than silently losing ingestion', async () => {
    const fail = new Error('database queue consumer stopped');
    const notifications: unknown[] = [];
    let notified!: (reason: unknown) => void;
    const notifiedPromise = new Promise<unknown>(resolve => { notified = resolve; });
    const worker = superviseQueue(async () => { throw fail; }, error => {
      notifications.push(error);
      notified(error);
    });
    expect(await notifiedPromise).toBe(fail);
    expect(notifications).toEqual([fail]);
    await expect(worker.stop()).rejects.toBe(fail);
    expect(notifications).toEqual([fail]);
  });

  test('reports a worker returning without a shutdown request', async () => {
    const notifications: unknown[] = [];
    let notified!: (reason: unknown) => void;
    const notifiedPromise = new Promise<unknown>(resolve => { notified = resolve; });
    const worker = superviseQueue(async () => {}, error => {
      notifications.push(error);
      notified(error);
    });
    expect(await notifiedPromise).toBeInstanceOf(Error);
    expect(notifications).toHaveLength(1);
    expect(notifications[0]).toBeInstanceOf(Error);
    await worker.stop();
  });
});
