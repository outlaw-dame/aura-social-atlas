/**
 * Durable queue recovery integration test. A disposable PostgreSQL database
 * is mandatory; never point GATEWAY_TEST_DATABASE_URL at production.
 * Uses an independent table/channel to avoid modifying Fedify application queues.
 */
import { expect, test } from 'bun:test';
import postgres from 'postgres';
import { PostgresMessageQueue } from '@fedify/postgres';

const databaseUrl = process.env.GATEWAY_TEST_DATABASE_URL;
const dbTest = databaseUrl ? test : test.skip;

dbTest('PostgreSQL queue recovers a message enqueued before worker startup and consumes it exactly once', async () => {
  const sql = postgres(databaseUrl!, { max: 4, connect_timeout: 5 });
  const options = {
    tableName: 'gateway_ci_recovery_messages',
    channelName: 'gateway_ci_recovery_channel',
    pollInterval: { milliseconds: 50 },
  };
  const producer = new PostgresMessageQueue(sql, options);
  let initialized = false;
  try {
    await producer.initialize();
    initialized = true;
    // The test table is exclusively owned by this disposable test case.
    // Reset only this table to exclude residue from a previous interrupted CI run.
    await sql`TRUNCATE gateway_ci_recovery_messages`;
    const marker = crypto.randomUUID();
    await producer.enqueue({ kind: 'queue-restart-regression', marker });
    expect((await producer.getDepth()).queued).toBe(1);

    // Simulate the producer process exiting; a fresh consumer instance opens
    // the same durable queue after the message has already been committed.
    const resumed = new PostgresMessageQueue(sql, options);
    await resumed.initialize();
    const controller = new AbortController();
    const received: unknown[] = [];
    let notify!: () => void;
    const delivered = new Promise<void>(resolve => { notify = resolve; });
    const consuming = resumed.listen(message => {
      received.push(message);
      notify();
    }, { signal: controller.signal });
    const deadline = setTimeout(() => controller.abort(), 5000);
    try {
      await Promise.race([
        delivered,
        consuming.then(() => { throw new Error('Queue worker stopped before recovering the pending message'); }),
      ]);
      expect(received).toEqual([{ kind: 'queue-restart-regression', marker }]);
    } finally {
      clearTimeout(deadline);
      controller.abort();
      await consuming;
    }

    // A second fresh instance observes no stranded work or redelivery.
    const afterRestart = new PostgresMessageQueue(sql, options);
    await afterRestart.initialize();
    expect((await afterRestart.getDepth()).queued).toBe(0);
  } finally {
    if (initialized) await producer.drop();
    await sql.end({ timeout: 5 });
  }
});
