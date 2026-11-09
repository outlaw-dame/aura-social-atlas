# Fedizen OAuth ownership constraints — production rollout gate

**Migration:** [`0003_fedizen_oauth_ownership.sql`](../drizzle/reviewed-not-applied/0003_fedizen_oauth_ownership.sql)  
**Status:** Reviewed SQL is quarantined **outside the executable Drizzle migrations directory and journal**. Disposable PostgreSQL tests pass. **Not applied to live Atlas/Lovable.** Releasing it requires verified backup/restore and separate operator approval.  
**Scope:** Atlas's own Supabase tables; no Fedizen or discovery-gateway schema changes.

## Evidence collected (2026-11-09)

Read-only queries against the matching Lovable project **Aura Browser** confirmed its Supabase database is enabled; the three Fedizen OAuth tables have RLS enabled, no policies permitting browser clients and no `anon`/`authenticated` grants. Current ownership preflight: 0 connection rows, 1 OAuth-state row, 0 orphaned rows, 0 duplicate state owners, 1 expired OAuth state. A `custom:app-oidc` identity-provider record exists; this does **not** establish a working current OIDC session.

No backup/restore interface has been exposed through the available Lovable connector. Accordingly, **do not run the production migration just because these SQL preflight checks pass**.

## 1. Operator-only prerequisites

1. Confirm the target is Atlas's **Lovable-managed Supabase** database for the GitHub repository `outlaw-dame/aura-social-atlas`. Never point migration tools at Fedizen's Bonfire database or the Fedify gateway.
2. Establish a *verified*, recent backup of that exact database, including `auth.users` and the Fedizen tables. Perform a **successful disposable restore** and record the restore result. If a provider-managed backup cannot be verified, **stop**. Never export bearer tokens, PKCE verifiers or client secrets into chat, logs, PRs or CI artifacts.
3. Have a privileged operator and rollback owner available. Arrange a short maintenance window or temporarily block *new Fedizen Connect starts* at the application edge to avoid a delete/insert race; existing read-only REST Home and native GraphQL gate remain unchanged. No user content edits are required.
4. Confirm the Drizzle journal currently ends at `0002_fedizen_connections` and the reviewed SQL is quarantined. **Only after** the verified backup, test restore, preflight, and operator approval, create a separately reviewed release PR that restores the SQL under `drizzle/migrations/`, adds its correct snapshot and journal entry, and runs the ordinary migration pipeline exactly once. Do not manually apply the SQL and then run Drizzle again.
5. Confirm disposable PostgreSQL [ownership migration CI](../.github/workflows/fedizen-owner-migration-test.yml) passed on the deployment commit, including negative preflight transaction rollback. Confirm the latest code security review has no unresolved findings.

## 2. Fresh live read-only preflight

Run these aggregate-only statements in the verified **Atlas** database. No bearer, account ID or OAuth state is selected.

```sql
SELECT 'connections' AS kind,
       count(*)::bigint AS total,
       count(*) FILTER (WHERE u.id IS NULL)::bigint AS orphaned
FROM public.fedizen_connections c
LEFT JOIN auth.users u ON u.id = c.user_id
UNION ALL
SELECT 'states', count(*)::bigint,
       count(*) FILTER (WHERE u.id IS NULL)::bigint
FROM public.fedizen_oauth_states s
LEFT JOIN auth.users u ON u.id = s.user_id;

SELECT count(*)::bigint AS users_with_duplicate_pending_states
FROM (
  SELECT user_id FROM public.fedizen_oauth_states
  GROUP BY user_id HAVING count(*) > 1
) duplicates;

SELECT count(*)::bigint AS expired_pending_states
FROM public.fedizen_oauth_states
WHERE created_at < now() - interval '15 minutes';

SELECT conrelid::regclass::text AS table_name,
       conname, pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE conrelid IN (
 'public.fedizen_connections'::regclass,
 'public.fedizen_oauth_states'::regclass
)
ORDER BY table_name, conname;
```

**Stop** if there are any orphans or duplicate pending states. Do not silently delete, rewrite, or reassign OAuth credentials or states to make the migration pass. Any cleanup requires a separately reviewed retention/repair decision and backup. An expired state *alone* does not prevent the migration and is left intact.

## 3. Controlled migration application

Do **not** apply the quarantined file directly. Promote it in a separate reviewed release PR **only after backup approval**, then use the deployment's standard privileged, journal-aware migration pipeline. Configure appropriate short **lock_timeout** and bounded **statement_timeout** in the migration session/transaction according to the runner's supported settings; verify the settings before applying. Schema changes require table locks, and existing Connect traffic should be quiesced.

The migration performs preflight checks, then adds:

- `fedizen_connections.user_id → auth.users(id)` with `ON DELETE CASCADE`
- `fedizen_oauth_states.user_id → auth.users(id)` with `ON DELETE CASCADE`
- `UNIQUE(fedizen_oauth_states.user_id)`

The unique constraint is compatible with the current `startConnect` design (remove prior state, then insert a new one), but concurrent starts may reject one attempt safely. Do not introduce blind retries of OAuth code redemption to compensate. No migration is authorized by an API test or successful probe alone.

## 4. Post-migration checks

- Verify both named FK constraints exist, are validated, point to `auth.users` and use `ON DELETE CASCADE`.
- Verify the per-user unique constraint exists on `fedizen_oauth_states`.
- Verify RLS is still enabled on all three Fedizen tables; `anon`/`authenticated` have no grants/policies.
- Compare aggregate row counts before/after; migration should not delete state or connection records.
- Confirm migrations are journaled exactly once, and the normal Atlas REST fallback continues to function with a consenting disposable identity (when available).
- After approval, re-enable Connect starts. Continue to keep `ATLAS_BONFIRE_NATIVE_GRAPHQL_READS` **disabled** until the independent [A/B acceptance](FEDIZEN_AUTH_ACCEPTANCE.md) actually passes.

## 5. Failure handling and rollback

On a preflight exception, lock timeout, or migration failure, stop and inspect the actual database and migration journal before retrying; verify whether the runner completed a transaction or left a partial schema. **Never re-run the SQL blindly.**

For a schema-only reversal after a confirmed completed migration, an operator may plan a separately reviewed migration that drops just the three newly added constraints, retaining the underlying data. This **cannot restore** rows already removed by `ON DELETE CASCADE`. Recovering deleted credentials/states requires a verified database backup and may require credential revocation/re-consent. Do not present dropping constraints as a complete data rollback.

For detailed authentication and privacy acceptance, see [Fedizen authorization runbook](FEDIZEN_AUTH_ACCEPTANCE.md). The independent relay discovery gateway is not in scope.
