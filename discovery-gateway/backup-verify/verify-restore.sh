#!/bin/sh
# Verify a logical backup into a distinct, disposable staging database.
# Never modify the source database. Credentials and key material are never printed.
set -eu
umask 077

[ "${RESTORE_CONFIRM:-}" = "isolated-staging-only" ] || { echo "FAIL: explicit staging confirmation required" >&2; exit 2; }
[ "${RAILWAY_ENVIRONMENT_NAME:-}" = "staging" ] || { echo "FAIL: staging environment required" >&2; exit 2; }
[ -n "${SOURCE_DATABASE_URL:-}" ] && [ -n "${DEST_DATABASE_URL:-}" ] || { echo "FAIL: database URLs missing" >&2; exit 2; }
[ "${SOURCE_DATABASE_URL}" != "${DEST_DATABASE_URL}" ] || { echo "FAIL: source and destination URLs identical" >&2; exit 2; }
case "${SOURCE_DATABASE_URL}" in *".railway.internal"*) ;; *) echo "FAIL: source must use private Railway network" >&2; exit 2;; esac
case "${DEST_DATABASE_URL}" in *".railway.internal"*) ;; *) echo "FAIL: destination must use private Railway network" >&2; exit 2;; esac

src_id=$(psql "${SOURCE_DATABASE_URL}" -X -A -t -q -v ON_ERROR_STOP=1 -c "SELECT system_identifier FROM pg_control_system()")
dst_id=$(psql "${DEST_DATABASE_URL}" -X -A -t -q -v ON_ERROR_STOP=1 -c "SELECT system_identifier FROM pg_control_system()")
[ -n "${src_id}" ] && [ -n "${dst_id}" ] && [ "${src_id}" != "${dst_id}" ] || {
  echo "FAIL: source/destination database clusters are not provably independent" >&2; exit 2;
}

# The source cluster remains strictly read-only throughout.
# The temporary file exists only inside this non-public, ephemeral container.
backup_file=$(mktemp /tmp/atlas-gateway-backup.XXXXXXXX)
cleanup() { rm -f "${backup_file}"; }
trap cleanup EXIT HUP INT TERM

pg_dump --dbname "${SOURCE_DATABASE_URL}" --format=custom --no-owner --no-acl --file "${backup_file}"
[ -s "${backup_file}" ] || { echo "FAIL: empty backup" >&2; exit 1; }
pg_restore --dbname "${DEST_DATABASE_URL}" --clean --if-exists --no-owner --no-privileges --exit-on-error "${backup_file}"

# Compare canonical state without printing private JWKs, subscription identifiers
# or copied content. The complete dump also contains Fedify's queue/KV schema.
fingerprint_query="SELECT md5(COALESCE(string_agg(actor_identifier || ':' || private_key::text || ':' || public_key::text, '|' ORDER BY actor_identifier), '')) FROM gateway_keys"
count_query="SELECT (SELECT count(*) FROM gateway_keys)::text || ':' || (SELECT count(*) FROM gateway_subscriptions)::text || ':' || (SELECT count(*) FROM gateway_items)::text || ':' || (SELECT count(*) FROM gateway_seen)::text"
schema_query="SELECT md5(COALESCE(string_agg(table_name, ',' ORDER BY table_name), '')) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'"
compare_query() {
  src=$(psql "${SOURCE_DATABASE_URL}" -X -A -t -q -v ON_ERROR_STOP=1 -c "$1")
  dst=$(psql "${DEST_DATABASE_URL}" -X -A -t -q -v ON_ERROR_STOP=1 -c "$1")
  [ "$src" = "$dst" ] || { echo "FAIL: restore comparison mismatch: $2" >&2; exit 1; }
  echo "PASS: $2"
}
compare_query "$fingerprint_query" "private/public service actor key continuity (values not disclosed)"
compare_query "$count_query" "key/subscription/item/dedup table counts"
compare_query "$schema_query" "all public database table names"
key_count=$(psql "${DEST_DATABASE_URL}" -X -A -t -q -v ON_ERROR_STOP=1 -c "SELECT count(*) FROM gateway_keys")
[ "${key_count}" -gt 0 ] || { echo "FAIL: missing actor key" >&2; exit 1; }
echo "PASS: source untouched, isolated destination restored from pg_dump archive"
