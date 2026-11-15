#!/bin/sh
# Deliberately separate from the live gateway worker and actor identity.
# Only removes expired cached discovery items, never keys, subscriptions,
# deduplication history or any Fedify durable queue tables.
set -eu
umask 077
: "${SOURCE_DATABASE_URL:?private PostgreSQL DSN required}"
: "${GATEWAY_RETENTION_DAYS:?retention period required}"
case "$GATEWAY_RETENTION_DAYS" in
  ''|*[!0-9]*) echo 'retention.invalid_days' >&2; exit 2 ;;
esac
[ "$GATEWAY_RETENTION_DAYS" -ge 1 ] && [ "$GATEWAY_RETENTION_DAYS" -le 365 ] || {
  echo 'retention.invalid_days' >&2; exit 2;
}
# Validate the effective libpq URI authority, not arbitrary DSN substrings.
# Query strings (including host/hostaddr/service overrides) and fragments are
# forbidden. Keep any credential values out of diagnostics.
private_retention_dsn() {
  dsn=$SOURCE_DATABASE_URL
  case "$dsn" in
    postgres://*|postgresql://*) ;;
    *) return 1 ;;
  esac
  case "$dsn" in
    *'?'*|*'#'*|*' '*|*'\t'*) return 1 ;;
  esac
  authority=${dsn#*://}
  case "$authority" in
    *@*/*) ;;
    *) return 1 ;;
  esac
  authority=${authority%%/*}
  case "$authority" in
    *@*@*) return 1 ;;
  esac
  hostport=${authority#*@}
  host=${hostport%:5432}
  [ "$hostport" != "$host" ] || return 1
  case "$host" in
    ?*.railway.internal) ;;
    *) return 1 ;;
  esac
  case "$host" in
    *[!a-zA-Z0-9.-]*|*..*|.*|-*|*-) return 1 ;;
  esac
  [ -z "${PGHOSTADDR:-}" ] && [ -z "${PGSERVICE:-}" ]
}
ci_local_retention_dsn() {
  dsn=$SOURCE_DATABASE_URL
  case "$dsn" in
    postgres://*|postgresql://*) ;;
    *) return 1 ;;
  esac
  case "$dsn" in
    *'?'*|*'#'*|*' '*|*'\t'*) return 1 ;;
  esac
  case "$dsn" in
    *@127.0.0.1:5432/*) ;;
    *) return 1 ;;
  esac
  [ -z "${PGHOSTADDR:-}" ] && [ -z "${PGSERVICE:-}" ]
}
if [ "${ATLAS_RETENTION_CI_LOCAL:-0}" = 1 ]; then
  [ "${CI:-}" = true ] && ci_local_retention_dsn || {
    echo 'retention.unsafe_ci_target' >&2; exit 2;
  }
else
  [ "${RAILWAY_ENVIRONMENT_NAME:-}" = staging ] && private_retention_dsn || {
    echo 'retention.non_private_database_or_environment' >&2; exit 2;
  }
fi

# Each invocation is finite (max 100 batches, 500 rows each) and uses
# short PostgreSQL lock and statement timeouts. Repeat on the next run
# for larger backlogs; do not lock the main gateway for a huge delete.
total=0
batch=0
while [ "$batch" -lt 100 ]; do
  removed="$(PGOPTIONS='-c lock_timeout=2000 -c statement_timeout=15000' \
    psql "$SOURCE_DATABASE_URL" -X -q -A -t -v ON_ERROR_STOP=1 \
      -c "
      WITH candidates AS (
        SELECT id FROM gateway_items
        WHERE ingested_at < now() - ($GATEWAY_RETENTION_DAYS::int * interval '1 day')
        ORDER BY ingested_at, id LIMIT 500
        FOR UPDATE SKIP LOCKED
      ), removed AS (
        DELETE FROM gateway_items AS item
        USING candidates WHERE item.id = candidates.id RETURNING item.id
      )
      SELECT count(*) FROM removed;
      ")"
  case "$removed" in ''|*[!0-9]*) echo 'retention.invalid_row_count' >&2; exit 1 ;; esac
  total=$((total + removed))
  batch=$((batch + 1))
  [ "$removed" -eq 500 ] || break
done
echo "retention.completed deleted=$total batches=$batch"
