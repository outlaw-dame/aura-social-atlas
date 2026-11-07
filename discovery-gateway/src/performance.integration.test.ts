/**
 * Disposable database performance characterization; NEVER execute on a live DB.
 * Owns gateway_ci_perf_items exclusively. Benchmarks are observational:
 * no brittle hardware-dependent latency pass/fail thresholds.
 */
import { expect, test } from 'bun:test';
import postgres from 'postgres';
import { PostgresMessageQueue } from '@fedify/postgres';

const url = process.env.GATEWAY_TEST_DATABASE_URL;
const integration = url ? test : test.skip;

integration('10k item text filter and retention profiling in disposable PostgreSQL', async () => {
  const sql = postgres(url!, { max: 2, connect_timeout: 5 });
  let created = false;
  try {
    // Test-specific table; do not touch gateway_items, gateway_keys, or the real queue.
    await sql`CREATE TABLE gateway_ci_perf_items (LIKE gateway_items INCLUDING ALL)`;
    created = true;
    await sql`
      INSERT INTO gateway_ci_perf_items
        (id, activity_id, relay_actor, author_id, object_origin, text, hashtags)
      SELECT
        'https://perf.example/objects/' || n::text,
        'https://perf.example/activities/' || n::text,
        'https://relay.perf.example/actor',
        'https://perf.example/author',
        'https://perf.example',
        CASE WHEN n % 37 = 0 THEN 'selective needle atlas ' || n::text
             ELSE 'ordinary atlas content ' || n::text END,
        '["atlas"]'::jsonb
      FROM generate_series(1, 10000) AS n`;
    const count = await sql<{ count: string }[]>`SELECT count(*)::text AS count FROM gateway_ci_perf_items`;
    expect(Number(count[0]!.count)).toBe(10_000);

    const explain = await sql.unsafe(
      "EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) " +
      "SELECT id FROM gateway_ci_perf_items WHERE text ILIKE '%needle%' " +
      "ORDER BY ingested_at DESC, id DESC LIMIT 20",
    );
    const plan = (explain[0] as Record<string, unknown>)['QUERY PLAN'] as
      { 'Execution Time': number; Plan: { 'Node Type': string; 'Actual Rows': number } }[];
    expect(Array.isArray(plan)).toBe(true);
    expect(plan[0]!['Execution Time']).toBeGreaterThanOrEqual(0);
    console.log(JSON.stringify({
      event: 'performance.search_10k',
      rows: 10000,
      executionMs: plan[0]!['Execution Time'],
      node: plan[0]!.Plan['Node Type'],
    }));

    // Existing pruning chooses the newest maxItems by (ingested_at, id).
    // We use the same SQL strategy on this isolated table to profile and
    // assert retained cardinality, without altering live retention behavior.
    const started = performance.now();
    await sql`
      DELETE FROM gateway_ci_perf_items WHERE id IN (
        SELECT id FROM gateway_ci_perf_items
        ORDER BY ingested_at DESC, id DESC OFFSET ${9000}
      )`;
    const durationMs = performance.now() - started;
    const remaining = await sql<{ count: string }[]>`
      SELECT count(*)::text AS count FROM gateway_ci_perf_items`;
    expect(Number(remaining[0]!.count)).toBe(9000);
    console.log(JSON.stringify({ event: 'performance.prune_10k', rowsBefore: 10000,
      rowsAfter: 9000, executionMs: Math.round(durationMs * 100) / 100 }));
  } finally {
    if (created) await sql`DROP TABLE gateway_ci_perf_items`;
    await sql.end({ timeout: 5 });
  }
});

integration('PostgreSQL queue delay and restart: no early processing, no duplicate processing', async () => {
  const sql = postgres(url!, { max: 4, connect_timeout: 5 });
  const q = new PostgresMessageQueue(sql, {
    tableName: 'gateway_ci_delay_messages',
    channelName: 'gateway_ci_delay_channel',
    pollInterval: { milliseconds: 30 },
  });
  let initialized = false;
  try {
    // Postgres queue uses the Fedify retry policy rather than a second native
    // retry mechanism; asserting the public adapter capability prevents drift.
    expect((q as PostgresMessageQueue & { nativeRetrial?: boolean }).nativeRetrial).not.toBe(true);
    await q.initialize();
    initialized = true;
    await sql`TRUNCATE gateway_ci_delay_messages`;
    const marker = crypto.randomUUID();
    const started = performance.now();
    await q.enqueue({ marker }, { delay: { milliseconds: 400 } });
    const consumer = new PostgresMessageQueue(sql, {
      tableName: 'gateway_ci_delay_messages',
      channelName: 'gateway_ci_delay_channel',
      pollInterval: { milliseconds: 30 },
    });
    await consumer.initialize();
    const controller = new AbortController();
    const received: Array<{ marker: string; at: number }> = [];
    const running = consumer.listen(async message => {
      const m = message as { marker: string };
      received.push({ marker: m.marker, at: performance.now() });
    }, { signal: controller.signal });
    try {
      await Bun.sleep(170);
      expect(received).toEqual([]);
      const deadline = performance.now() + 5000;
      while (received.length === 0 && performance.now() < deadline) {
        await Bun.sleep(30);
      }
      expect(received).toHaveLength(1);
      expect(received[0]!.marker).toBe(marker);
      expect(received[0]!.at - started).toBeGreaterThanOrEqual(300);
      await Bun.sleep(100);
      expect(received).toHaveLength(1);
    } finally {
      controller.abort();
      await running;
    }
    const after = new PostgresMessageQueue(sql, {
      tableName: 'gateway_ci_delay_messages',
      channelName: 'gateway_ci_delay_channel',
    });
    await after.initialize();
    expect((await after.getDepth()).queued).toBe(0);
  } finally {
    if (initialized) await q.drop();
    await sql.end({ timeout: 5 });
  }
});
