/**
 * Disposable CI PostgreSQL query/retention baseline. No production DB access.
 * Uses a dedicated temporary table, never the real gateway_items table.
 * Reports EXPLAIN ANALYZE timings for realistic text, tag and origin filters
 * before changing indexes or the retention algorithm.
 */
import postgres from 'postgres';

const url = process.env.GATEWAY_TEST_DATABASE_URL;
if (!url) throw new Error('A disposable GATEWAY_TEST_DATABASE_URL is mandatory');
const sql = postgres(url, { max: 1, connect_timeout: 5 });
const count = 10_000;
const table = 'gateway_ci_perf_items';
const measure = async (name: string, query: Promise<Record<string, unknown>[]>) => {
  const result = await query;
  const plans = result as unknown as { 'QUERY PLAN': Array<{
    'Execution Time': number; Plan: { 'Actual Rows': number; 'Node Type': string };
  }> }[];
  const plan = plans[0]?.['QUERY PLAN']?.[0];
  if (!plan || !Number.isFinite(plan['Execution Time']))
    throw new Error('Invalid EXPLAIN JSON plan: ' + name);
  console.log(JSON.stringify({
    metric: name, executionMs: plan['Execution Time'],
    rootNode: plan.Plan['Node Type'], rootRows: plan.Plan['Actual Rows'],
  }));
  if (plan['Execution Time'] > 3_000)
    throw new Error('Slow isolated benchmark (3s guard): ' + name);
};
try {
  // Dedicated CI-only temporary table: avoids modifying any gateway data.
  await sql.unsafe(`CREATE TEMP TABLE ${table} (
    id TEXT PRIMARY KEY,
    activity_id TEXT NOT NULL UNIQUE,
    object_origin TEXT NOT NULL,
    author_name TEXT,
    author_handle TEXT,
    text TEXT NOT NULL,
    hashtags JSONB NOT NULL,
    ingested_at TIMESTAMPTZ NOT NULL
  ) ON COMMIT PRESERVE ROWS`);
  await sql.unsafe(`INSERT INTO ${table}
    SELECT 'https://bench.example/posts/' || i,
      'https://bench.example/activities/' || i,
      'https://' || CASE WHEN i % 4 = 0 THEN 'news' ELSE 'bench' END || '.example',
      'Benchmark Author ' || i,
      '@author' || i || '@bench.example',
      'Synthetic discovery benchmark text ' || i ||
        CASE WHEN i % 29 = 0 THEN ' specific search needle' ELSE '' END,
      CASE WHEN i % 7 = 0 THEN '["testing"]'::jsonb ELSE '[]'::jsonb END,
      '2026-11-01'::timestamptz + i * interval '1 second'
    FROM generate_series(1, ${count}) i`);
  await sql.unsafe(`CREATE INDEX gateway_ci_perf_ingested ON ${table} (ingested_at DESC,id DESC)`);
  await sql.unsafe(`CREATE INDEX gateway_ci_perf_origin ON ${table} (object_origin)`);
  await sql.unsafe(`CREATE INDEX gateway_ci_perf_tags ON ${table} USING gin (hashtags)`);
  await sql.unsafe(`ANALYZE ${table}`);

  await measure('ordered_first_page', sql.unsafe(`
    EXPLAIN (ANALYZE, FORMAT JSON)
    SELECT id FROM ${table}
    ORDER BY ingested_at DESC, id DESC LIMIT 21`) as Promise<Record<string,unknown>[]>);
  await measure('origin_filtered_page', sql.unsafe(`
    EXPLAIN (ANALYZE, FORMAT JSON)
    SELECT id FROM ${table}
    WHERE object_origin = 'https://news.example'
    ORDER BY ingested_at DESC,id DESC LIMIT 21`) as Promise<Record<string,unknown>[]>);
  await measure('hashtag_filtered_page', sql.unsafe(`
    EXPLAIN (ANALYZE, FORMAT JSON)
    SELECT id FROM ${table}
    WHERE hashtags @> '["testing"]'::jsonb
    ORDER BY ingested_at DESC,id DESC LIMIT 21`) as Promise<Record<string,unknown>[]>);
  await measure('unindexed_text_search', sql.unsafe(`
    EXPLAIN (ANALYZE, FORMAT JSON)
    SELECT id FROM ${table}
    WHERE text ILIKE '%specific search needle%'
      OR author_name ILIKE '%specific search needle%'
      OR author_handle ILIKE '%specific search needle%'
    ORDER BY ingested_at DESC,id DESC LIMIT 21`) as Promise<Record<string,unknown>[]>);
  await measure('retention_offset_10k', sql.unsafe(`
    EXPLAIN (ANALYZE, FORMAT JSON)
    DELETE FROM ${table} WHERE id IN (
      SELECT id FROM ${table}
      ORDER BY ingested_at DESC,id DESC OFFSET 9000
    )`) as Promise<Record<string,unknown>[]>);
  console.log(JSON.stringify({ metric: 'benchmark.completed', rows: count }));
} finally {
  await sql.end({ timeout: 5 });
}
