/** Durable PostgreSQL stores in production; memory only for local dev/tests. */
import { InProcessMessageQueue, MemoryKvStore } from '@fedify/fedify';
import type { Sql } from 'postgres';
import type { GatewayConfig } from './config.ts';
import type { GatewayStores } from './federation.ts';
import { initSchema } from './db.ts';

export type Stores = GatewayStores & { ping: () => Promise<boolean>; close: () => Promise<void> };

export async function storesFor(cfg: GatewayConfig): Promise<Stores> {
  if (cfg.devMemoryStore) {
    // Dev/test mode still requires a database for subscriptions/items/keys.
    throw new Error('GATEWAY_DEV_MEMORY is not supported: subscriptions and items require PostgreSQL. Set DATABASE_URL.');
  }
  const [{ default: postgres }, { PostgresKvStore, PostgresMessageQueue }] = await Promise.all([import('postgres'), import('@fedify/postgres')]);
  const sql: Sql = postgres(cfg.databaseUrl!, { max: 10, idle_timeout: 30, connect_timeout: 10, onnotice: () => {} });
  const kv = new PostgresKvStore(sql);
  const queue = new PostgresMessageQueue(sql);
  try {
    // PostgreSQL's IF NOT EXISTS is not concurrency-safe for simultaneous DDL:
    // web and worker can both try to create a table's implicit composite type.
    // Serialize *all* Fedify and gateway schema initialization across processes.
    // The transaction owns the advisory lock while initialization uses the pool;
    // no schema DDL is executed inside this lock-holding transaction.
    await sql.begin(async tx => {
      await tx`SELECT pg_advisory_xact_lock(4271801, 1)`;
      await kv.initialize();
      await queue.initialize();
      await initSchema(sql);
    });
  } catch (error) {
    await sql.end({ timeout: 5 }).catch(() => {});
    throw error;
  }
  return {
    kv, queue, sql,
    ping: async () => { try { await sql`select 1`; return true; } catch { return false; } },
    close: async () => { await sql.end({ timeout: 5 }); },
  };
}
