/**
 * Disposable PostgreSQL integration test for the exact Fedizen OAuth
 * migrations. Run only against the dedicated CI ephemeral database.
 * Never point this test at a live Lovable/Supabase or Railway database.
 */
import postgres from 'postgres';
import { readFileSync } from 'node:fs';
import { strict as assert } from 'node:assert';
import { safeDisposablePostgresUrl } from './disposable-postgres-url.mjs';

const url = process.env['ATLAS_MIGRATION_TEST_DATABASE_URL'];
if (!safeDisposablePostgresUrl(url)) {
  throw new Error('Migration integration tests require local, exact atlas_migration_test database on port 5432');
}
const sql = postgres(url, { max: 1, prepare: false });
const A = '00000000-0000-4000-8000-000000000001';
const B = '00000000-0000-4000-8000-000000000002';
const C = '00000000-0000-4000-8000-000000000003';
const migration = (name) => readFileSync(new URL(`../drizzle/migrations/${name}`, import.meta.url), 'utf8');
const reviewedOwnershipMigration = readFileSync(
  new URL('../drizzle/reviewed-not-applied/0003_fedizen_oauth_ownership.sql', import.meta.url), 'utf8',
);

async function rejectCode(run, code) {
  let found = null;
  try { await run(); } catch (e) { found = e?.code; }
  assert.equal(found, code);
}

try {
  await sql.unsafe('CREATE SCHEMA auth');
  await sql.unsafe('CREATE TABLE auth.users (id uuid PRIMARY KEY)');
  await sql.unsafe("CREATE ROLE anon NOLOGIN");
  await sql.unsafe("CREATE ROLE authenticated NOLOGIN");
  await sql.unsafe("CREATE ROLE service_role NOLOGIN");

  // Check that the migration we ship works against its real predecessor,
  // not just a hand-written approximation.
  await sql.unsafe(migration('0002_fedizen_connections.sql'));
  await sql`INSERT INTO auth.users (id) VALUES (${A}), (${B})`;
  await sql`INSERT INTO public.fedizen_connections (user_id, access_token, scope, account_handle)
    VALUES (${A}, 'test-only-a', 'read', 'alice')`;
  await sql`INSERT INTO public.fedizen_oauth_states
    (state, user_id, code_verifier, redirect_uri)
    VALUES ('test-state-a', ${A}, 'test-pkce-a', 'https://atlas.example/fedizen/callback')`;

  // Any orphaned row must abort the exact migration atomically. CI fixtures
  // are rolled back; no expired states or real credentials are ever deleted.
  await assert.rejects(sql.begin(async tx => {
    await tx`INSERT INTO public.fedizen_connections
      (user_id, access_token, scope) VALUES (${C}, 'test-orphan', 'read')`;
    await tx.unsafe(reviewedOwnershipMigration);
  }), /Fedizen connection ownership preflight failed/);
  assert.equal((await sql`SELECT count(*)::int AS count FROM public.fedizen_connections
    WHERE user_id = ${C}`)[0].count, 0);

  // A second unconsumed authorization attempt for a single user is unsafe
  // under the new unique constraint and must fail before schema changes.
  await assert.rejects(sql.begin(async tx => {
    await tx`INSERT INTO public.fedizen_oauth_states
      (state, user_id, code_verifier, redirect_uri)
      VALUES ('test-state-a-2', ${A}, 'test-pkce-2', 'https://atlas.example/fedizen/callback')`;
    await tx.unsafe(reviewedOwnershipMigration);
  }), /More than one pending OAuth state/);
  assert.equal((await sql`SELECT count(*)::int AS count FROM public.fedizen_oauth_states
    WHERE user_id = ${A}`)[0].count, 1);

  await sql.unsafe(reviewedOwnershipMigration);

  const fk = await sql`SELECT conname, pg_get_constraintdef(oid) AS definition
    FROM pg_constraint WHERE conrelid IN
    ('public.fedizen_oauth_states'::regclass, 'public.fedizen_connections'::regclass)
    AND contype = 'f' ORDER BY conname`;
  assert.equal(fk.length, 2);
  assert.ok(fk.every(row => row.definition.includes('ON DELETE CASCADE')));

  await rejectCode(() => sql`INSERT INTO public.fedizen_oauth_states
    (state, user_id, code_verifier, redirect_uri)
    VALUES ('other-state-a', ${A}, 'test-pkce-2', 'https://atlas.example/fedizen/callback')`, '23505');

  await rejectCode(() => sql`INSERT INTO public.fedizen_connections
    (user_id, access_token, scope) VALUES (${C}, 'orphan-token', 'read')`, '23503');

  await sql`INSERT INTO public.fedizen_connections (user_id, access_token, scope)
    VALUES (${B}, 'test-only-b', 'read')`;
  await sql`INSERT INTO public.fedizen_oauth_states (state, user_id, code_verifier, redirect_uri)
    VALUES ('test-state-b', ${B}, 'test-pkce-b', 'https://atlas.example/fedizen/callback')`;
  await sql`DELETE FROM auth.users WHERE id = ${B}`;
  assert.equal((await sql`SELECT count(*)::int AS count FROM public.fedizen_connections
    WHERE user_id = ${B}`)[0].count, 0);
  assert.equal((await sql`SELECT count(*)::int AS count FROM public.fedizen_oauth_states
    WHERE user_id = ${B}`)[0].count, 0);
  assert.equal((await sql`SELECT count(*)::int AS count FROM public.fedizen_connections
    WHERE user_id = ${A}`)[0].count, 1);

  for (const table of ['fedizen_connections', 'fedizen_oauth_states', 'fedizen_oauth_apps']) {
    const row = (await sql`SELECT relrowsecurity AS enabled FROM pg_class
      WHERE oid = ${'public.' + table}::regclass`)[0];
    assert.equal(row.enabled, true);
    const grants = await sql`SELECT
      has_table_privilege('anon', ${'public.' + table}, 'SELECT') AS anon,
      has_table_privilege('authenticated', ${'public.' + table}, 'SELECT') AS authenticated`;
    assert.equal(grants[0].anon, false);
    assert.equal(grants[0].authenticated, false);
  }

  console.log('PASS: real 0002→0003 PostgreSQL Fedizen ownership migration, FK/unique/cascade/RLS checks');
} finally {
  await sql.end({ timeout: 5 });
}
