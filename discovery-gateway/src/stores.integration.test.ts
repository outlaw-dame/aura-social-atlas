/** Real first-start concurrency test using its own disposable PostgreSQL database. */
import { expect, test } from 'bun:test';
import postgres from 'postgres';
import type { GatewayConfig } from './config.ts';
import { storesFor, type Stores } from './stores.ts';

const databaseUrl = process.env.GATEWAY_TEST_DATABASE_URL;
const dbTest = databaseUrl ? test : test.skip;

dbTest('six independent pools initialize a genuinely empty PostgreSQL database', async () => {
  const url = new URL(databaseUrl!);
  // Database creation/destruction must never touch a configured deployment.
  if (!['localhost', '127.0.0.1'].includes(url.hostname) || url.pathname !== '/gateway_integration') {
    throw new Error('first-start regression requires local disposable gateway_integration database');
  }
  const database = 'gateway_startup_' + crypto.randomUUID().replaceAll('-', '');
  const isolatedUrl = new URL(url);
  isolatedUrl.pathname = '/' + database;
  const admin = postgres(databaseUrl!, { max: 1, connect_timeout: 5 });
  let created = false;
  let stores: Stores[] = [];
  try {
    await admin.unsafe('CREATE DATABASE "' + database + '"');
    created = true;
    const cfg = { databaseUrl: isolatedUrl.toString(), devMemoryStore: false } as GatewayConfig;
    const settled = await Promise.allSettled(Array.from({ length: 6 }, () => storesFor(cfg)));
    stores = settled.flatMap(result => result.status === 'fulfilled' ? [result.value] : []);
    const errors = settled.flatMap(result => result.status === 'rejected' ? [String(result.reason)] : []);
    expect(errors).toEqual([]);
    expect(stores).toHaveLength(6);
    expect(await Promise.all(stores.map(s => s.ping()))).toEqual(Array(6).fill(true));
    const sql = stores[0]?.sql;
    if (!sql) throw new Error('missing SQL store after startup');
    const tables = await sql`
      SELECT count(*)::int AS count FROM information_schema.tables
      WHERE table_schema = current_schema()
        AND table_name IN ('gateway_keys', 'gateway_subscriptions', 'gateway_items', 'gateway_seen')`;
    expect(tables[0]?.count).toBe(4);
  } finally {
    await Promise.allSettled(stores.map(s => s.close()));
    try {
      if (created) await admin.unsafe('DROP DATABASE "' + database + '" WITH (FORCE)');
    } finally {
      await admin.end({ timeout: 5 });
    }
  }
});
