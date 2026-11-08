# Optional staging-only cached-content retention job

This is a tested **standalone**, one-shot PostgreSQL maintenance job. It is
**not automatically deployed or enabled**. It never alters actor keys,
subscriptions, Fedify queues or activity deduplication history.

## Safety model

- Requires `SOURCE_DATABASE_URL` through Railway's private network and
  `RAILWAY_ENVIRONMENT_NAME=staging`; refuses other environments.
- Requires explicit `GATEWAY_RETENTION_DAYS` in **1–365**.
- Deletes only from `gateway_items` where `ingested_at` is older than that
  interval. Uses bounded transactions with short lock and statement timeouts,
  `FOR UPDATE SKIP LOCKED`, maximum 500 rows per batch and 100 batches per run.
- Leaves original actor keypairs, subscriptions, seen activity IDs and durable
  queue records unchanged. Historical deduplication retention must be designed
  separately; never simply purge `gateway_seen` and permit replaying old
  federation activities without a policy.
- The job reads the `Postgres.DATABASE_URL` connection, requiring careful
  credentials and **least-privilege delete permission** before any activation.
- No service domain, TCP proxy or volume. Keep the source at a reviewed immutable
  commit and set `restartPolicyType=NEVER`.

## Activation prerequisites

1. Review the actual content retention policy and legal obligations; choose
   the correct number of days. `30` is the CI demonstration value only,
   not a consented live policy.
2. Confirm encrypted offsite backup and independent recovery are operational
   before any production-scale destruction.
3. Test against a disposable copy of staging data first. Only then connect
   the narrowly privileged maintenance database credential.
4. Run one manual staging job and check its deleted-row count against
   expectations, then consider a daily Railway cron. Expose the result to
   queue/operations alerting.
5. Determine whether stale content also needs to be excluded from read
   responses *before* the next job fires. This script alone does not
   guarantee immediate removal at the moment a post reaches the retention
   threshold; job scheduling and enforcement must be reviewed.

The GitHub Action `gateway-retention-drill.yml` uses a **disposable** PostgreSQL
18 service, inserts synthetic expired and recent content, verifies exactly one
expired row is deleted, preserves actor keys/subscriptions/seen/queue, and proves
a second execution is idempotent. It never targets the live Railway database.

This is not a comprehensive moderation, deletion request, or privacy retention
policy. The release checklist in
[issue #23](https://github.com/outlaw-dame/aura-social-atlas/issues/23)
remains authoritative.
