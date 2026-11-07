#!/bin/sh
# Disposable, staging-only logical backup/restore drill.
# Never provide a production DATABASE_URL; never expose database services publicly.
set -eu
umask 077

: "${SOURCE_DATABASE_URL:?SOURCE_DATABASE_URL required}"
: "${RESTORE_DATABASE_URL:?RESTORE_DATABASE_URL required}"

case "$SOURCE_DATABASE_URL" in
  *postgres*) ;;
  *) echo "invalid source DSN" >&2; exit 2 ;;
esac
[ "$SOURCE_DATABASE_URL" != "$RESTORE_DATABASE_URL" ] || {
  echo "source/restore DSNs identical; refusing to run" >&2
  exit 2
}

tmpdir="$(mktemp -d)"
trap 'rm -rf "$tmpdir"' EXIT HUP INT TERM
dump="$tmpdir/gateway.dump"
echo "drill.started"

# A real, consistent pg_dump snapshot containing gateway keypairs and data.
# Temporary files are mode 0600, never printed or uploaded.
pg_dump "$SOURCE_DATABASE_URL" \
  --format=custom --no-owner --no-acl --file="$dump"
[ -s "$dump" ] || { echo "drill.empty_dump" >&2; exit 1; }
pg_restore --list "$dump" >/dev/null
echo "drill.backup_readable"

# The target must be a fresh, isolated scratch database.
# Refuse to overwrite tables even if credentials accidentally point to a
# pre-existing Railway service.
existing="$(psql "$RESTORE_DATABASE_URL" -X -A -t -v ON_ERROR_STOP=1 -c \
  "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE';")"
[ "$existing" = "0" ] || { echo "drill.refused_nonempty_target" >&2; exit 2; }

pg_restore --dbname="$RESTORE_DATABASE_URL" \
  --no-owner --no-acl --exit-on-error "$dump"
echo "drill.restore_completed"

# Compare immutable service-actor keys without exposing the JWK.
# PostgreSQL's JSONB textual form is canonical for the same server versions.
query="SELECT actor_identifier || ':' || md5(private_key::text || public_key::text)
       FROM gateway_keys ORDER BY actor_identifier"
source_keys="$(psql "$SOURCE_DATABASE_URL" -X -A -t -v ON_ERROR_STOP=1 -c "$query")"
restore_keys="$(psql "$RESTORE_DATABASE_URL" -X -A -t -v ON_ERROR_STOP=1 -c "$query")"
[ -n "$source_keys" ] || { echo "drill.source_actor_keys_missing" >&2; exit 1; }
[ "$source_keys" = "$restore_keys" ] || { echo "drill.signing_keys_mismatch" >&2; exit 1; }
echo "drill.actor_keys_identical"

# Strictly compare object and subscription IDs while staging has no live
# subscribers beyond the synthetic fixture. A concurrent source write can
# legitimately occur between the snapshot and verification; fail closed.
for table in gateway_subscriptions gateway_items gateway_seen; do
  case "$table" in
    gateway_subscriptions) key=actor_url ;;
    gateway_items) key=id ;;
    gateway_seen) key=activity_id ;;
  esac
  qry="SELECT coalesce(md5(string_agg($key, E'\\n' ORDER BY $key)), md5(''))
        FROM $table"
  src="$(psql "$SOURCE_DATABASE_URL" -X -A -t -v ON_ERROR_STOP=1 -c "$qry")"
  dst="$(psql "$RESTORE_DATABASE_URL" -X -A -t -v ON_ERROR_STOP=1 -c "$qry")"
  [ "$src" = "$dst" ] || {
    echo "drill.snapshot_data_changed_or_mismatched table=$table" >&2
    exit 1
  }
  echo "drill.table_ids_identical table=$table"
done
echo "drill.passed"
# Keep the successful short-lived job available for log inspection until
# the disposable scratch DB and job are explicitly deleted by the operator.
if [ "${DRILL_KEEP_ALIVE:-1}" = "1" ]; then
  sleep infinity
fi
