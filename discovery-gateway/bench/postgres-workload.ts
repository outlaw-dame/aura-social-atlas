/** Bounded, synthetic PostgreSQL workload plans. Never run against a live database. */
import postgres from 'postgres';
import { initSchema } from '../src/db.ts';

const url = process.env.GATEWAY_TEST_DATABASE_URL;
if (process.env.BENCH_DISPOSABLE !== '1' || !url) {
  throw new Error('BENCH_DISPOSABLE=1 and GATEWAY_TEST_DATABASE_URL required');
}
const parsed = new URL(url);
if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(parsed.hostname)) {
  throw new Error('benchmark database must be a disposable local PostgreSQL instance');
}
if (!/integration|bench|test/.test(parsed.pathname)) {
  throw new Error('benchmark database must have an explicit disposable name');
}
const sql = postgres(url, { max: 3, connect_timeout: 5 });
const count = 12_000;
const maxAllowed = 30_000;
if (count > maxAllowed) throw new Error('benchmark dataset cap exceeded');

function report(label: string, rows: Record<string, unknown>[]) {
  const value = rows[0]?.['QUERY PLAN'];
  const plans = typeof value === 'string' ? JSON.parse(value) : value;
  if (!Array.isArray(plans) || !plans[0]?.Plan) throw new Error('unexpected EXPLAIN output');
  const root = plans[0];
  console.log(JSON.stringify({
    scenario: label, rows: count,
    executionMs: root['Execution Time'], planningMs: root['Planning Time'],
    planNode: root.Plan['Node Type'], actualRows: root.Plan['Actual Rows'],
    sharedHit: root.Plan['Shared Hit Blocks'], sharedRead: root.Plan['Shared Read Blocks'],
  }));
}

try {
  await initSchema(sql);
  // Test DB is disposable and the prior integration suite has already ended.
  const existing = await sql`SELECT count(*)::int AS count FROM gateway_items`;
  if (existing[0]?.count !== 0) throw new Error('benchmark requires an empty gateway_items table');
  await sql`
    INSERT INTO gateway_items (
      id, activity_id, relay_actor, author_id, author_name,
      author_handle, object_origin, text, hashtags, published_at
    )
    SELECT 'https://bench.example/posts/' || g,
           'https://bench.example/activities/' || g,
           'https://relay.bench.example/actor',
           'https://bench.example/actor',
           'Benchmark Author ' || (g % 200),
           '@benchmark@bench.example',
           'https://bench.example',
           CASE WHEN g % 20 = 0
             THEN 'targetword synthetic federation content ' || repeat('a', 220)
             ELSE 'synthetic federation content ' || repeat('b', 220) END,
           '["benchmark"]'::jsonb, now()
    FROM generate_series(1, ${count}) AS g
  `;
  await sql`ANALYZE gateway_items`;
  const fullSearch = await sql.unsafe(
    `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
     SELECT id FROM gateway_items WHERE text ILIKE '%targetword%'
     ORDER BY ingested_at DESC, id DESC LIMIT 21`,
  );
  report('ILIKE_search_12k', fullSearch);
  const authorSearch = await sql.unsafe(
    `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
     SELECT id FROM gateway_items WHERE author_name ILIKE '%Author 17%'
     ORDER BY ingested_at DESC, id DESC LIMIT 21`,
  );
  report('ILIKE_author_12k', authorSearch);
  const indexedActor = await sql.unsafe(
    `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
     SELECT 1 FROM gateway_subscriptions
     WHERE actor_url = 'https://benchmark-actor.example/actor' AND state = 'accepted'
     LIMIT 1`,
  );
  report('indexed_subscription_lookup', indexedActor);

  const marker = new Error('EXPECTED_TRANSACTION_ROLLBACK');
  try {
    await sql.begin(async (tx) => {
      const rows = await tx.unsafe(
        `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
         DELETE FROM gateway_items WHERE id IN (
           SELECT id FROM gateway_items
           ORDER BY ingested_at DESC, id DESC OFFSET 5000
         )`,
      );
      report('prune_offset_12k_keep_5k', rows);
      throw marker; // Roll back benchmark DELETE, never persist pruning changes.
    });
    throw new Error('benchmark transaction unexpectedly committed');
  } catch (e) {
    if (e !== marker) throw e;
  }
} finally {
  // Dedicated, disposable CI instance only. No production connectivity.
  await sql`TRUNCATE gateway_items`;
  await sql.end({ timeout: 5 });
}
