/** Isolated, two-process outage drill. Only run against a disposable CI Postgres.
 * Phase 1 commits a queued message before Postgres is stopped.
 * Phase 2 starts a different consumer after the database restart.
 * Never point GATEWAY_TEST_DATABASE_URL at staging or production.
 */
import { expect } from 'bun:test';
import postgres from 'postgres';
import { PostgresMessageQueue } from '@fedify/postgres';

const phase = process.argv[2];
if (phase !== 'seed' && phase !== 'verify') throw new Error('Expected seed or verify phase');
const url = process.env.GATEWAY_TEST_DATABASE_URL;
if (!url || process.env.ATLAS_DISPOSABLE_DB_DRILL !== '1') {
  throw new Error('Disposable database drill opt-in and DSN are mandatory');
}
const target = new URL(url);
if (!['127.0.0.1', 'localhost', '::1', '[::1]'].includes(target.hostname)) {
  throw new Error('Refusing a non-local database: use an isolated CI container only');
}
const sql = postgres(url, { max: 3, connect_timeout: 5, idle_timeout: 5 });
const queue = new PostgresMessageQueue(sql, {
  tableName: 'gateway_ci_outage_recovery_queue',
  channelName: 'gateway_ci_outage_recovery_signal',
  pollInterval: { milliseconds: 50 },
});
try {
  await queue.initialize();
  if (phase === 'seed') {
    await sql`TRUNCATE gateway_ci_outage_recovery_queue`;
    await queue.enqueue({ kind: 'staged-outage-test', marker: 'only-in-disposable-ci' });
    expect((await queue.getDepth()).queued).toBe(1);
    console.log('drill.seeded_committed_queue');
  } else {
    expect((await queue.getDepth()).queued).toBe(1);
    const abort = new AbortController();
    const received: unknown[] = [];
    let resolveReceived!: () => void;
    const first = new Promise<void>(resolve => { resolveReceived = resolve; });
    const listening = queue.listen(message => {
      received.push(message);
      resolveReceived();
    }, { signal: abort.signal });
    const deadline = setTimeout(() => abort.abort(), 10_000);
    try {
      await Promise.race([
        first,
        listening.then(() => { throw new Error('Consumer exited before recovery'); }),
      ]);
      expect(received).toEqual([{ kind: 'staged-outage-test', marker: 'only-in-disposable-ci' }]);
    } finally {
      clearTimeout(deadline);
      abort.abort();
      await listening;
    }
    expect((await queue.getDepth()).queued).toBe(0);
    await queue.drop();
    console.log('drill.replayed_once_after_postgres_restart');
  }
} finally {
  await sql.end({ timeout: 5 });
}
