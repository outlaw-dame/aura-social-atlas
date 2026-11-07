/** Exercise concurrent web/worker startup against disposable PostgreSQL. */
import { expect, test } from 'bun:test';
import type { GatewayConfig } from './config.ts';
import { storesFor } from './stores.ts';

const databaseUrl = process.env.GATEWAY_TEST_DATABASE_URL;
const dbTest = databaseUrl ? test : test.skip;

dbTest('concurrent gateway store initialization succeeds across independent pools', async () => {
  const cfg = { databaseUrl, devMemoryStore: false } as GatewayConfig;
  const stores = await Promise.all(Array.from({ length: 6 }, () => storesFor(cfg)));
  try {
    expect(await Promise.all(stores.map(s => s.ping()))).toEqual(Array(6).fill(true));
    // All initializers completed, not merely opened connections.
    const tables = await stores[0]!.sql`
      SELECT count(*)::int AS count FROM information_schema.tables
      WHERE table_schema = current_schema()
        AND table_name IN ('gateway_keys', 'gateway_subscriptions', 'gateway_items', 'gateway_seen')`;
    expect(tables[0]?.count).toBe(4);
  } finally {
    await Promise.all(stores.map(s => s.close()));
  }
});
