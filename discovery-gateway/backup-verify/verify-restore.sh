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
# Every non-system schema and every object within the ordinary public
# schema must be absent. PostgreSQL's default empty "public" schema is okay.
dest_objects=$(psql "${DEST_DATABASE_URL}" -X -A -t -q -v ON_ERROR_STOP=1 -c "
  SELECT
    (SELECT count(*) FROM pg_namespace
      WHERE nspname <> 'public' AND nspname <> 'information_schema'
        AND nspname NOT LIKE 'pg_%')
    +
    (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON c.relnamespace=n.oid
      WHERE n.nspname='public')
    +
    (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON p.pronamespace=n.oid
      WHERE n.nspname='public')
    +
    (SELECT count(*) FROM pg_type t JOIN pg_namespace n ON t.typnamespace=n.oid
      WHERE n.nspname='public' AND t.typtype IN ('e','d','r'))
  ")
[ "${dest_objects}" = "0" ] || {
  echo "FAIL: destination contains user-owned schema objects; refusing overwrite" >&2; exit 2;
}

# The source cluster remains strictly read-only throughout.
# The temporary file exists only inside this non-public, ephemeral container.
backup_file=$(mktemp /tmp/atlas-gateway-backup.XXXXXXXX)
cleanup() { rm -f "${backup_file}"; }
trap cleanup EXIT HUP INT TERM

# Service actor key is stable throughout the staging snapshot. Record a
# fingerprint BEFORE export, then validate the restored snapshot against that
# baseline; never compare mutable item/subscription counts against later live
# source state.
fingerprint_query="SELECT md5(COALESCE(string_agg(actor_identifier || ':' || private_key::text || ':' || public_key::text, '|' ORDER BY actor_identifier), '')) FROM gateway_keys"
original_actor_fingerprint=$(psql "${SOURCE_DATABASE_URL}" -X -A -t -q -v ON_ERROR_STOP=1 -c "$fingerprint_query")
pg_dump --dbname "${SOURCE_DATABASE_URL}" --format=custom --no-owner --no-acl --file "${backup_file}"
[ -s "${backup_file}" ] || { echo "FAIL: empty backup" >&2; exit 1; }
pg_restore --dbname "${DEST_DATABASE_URL}" --no-owner --no-privileges --exit-on-error "${backup_file}"

# pg_dump itself exports one consistent database snapshot. Comparing against
# the source *after* the dump would race with legitimate inbound writes.
# Instead ensure the archive restored without error and verify the recovered
# key identity against the stable pre-dump baseline. Never print secret values.
restored_actor_fingerprint=$(psql "${DEST_DATABASE_URL}" -X -A -t -q -v ON_ERROR_STOP=1 -c "$fingerprint_query")
[ "$restored_actor_fingerprint" = "$original_actor_fingerprint" ] || {
  echo "FAIL: restored service actor keys differ from the snapshot baseline" >&2; exit 1;
}
echo "PASS: recovered private/public actor keys match the pre-export baseline"
key_count=$(psql "${DEST_DATABASE_URL}" -X -A -t -q -v ON_ERROR_STOP=1 -c "SELECT count(*) FROM gateway_keys")
[ "${key_count}" -gt 0 ] || { echo "FAIL: missing actor key" >&2; exit 1; }
for table in gateway_subscriptions gateway_items gateway_seen; do
  # Existence is mandatory; exact row counts depend on the consistent dump
  # snapshot and cannot be compared to a concurrently changing live source.
  exists=$(psql "${DEST_DATABASE_URL}" -X -A -t -q -v ON_ERROR_STOP=1 -c "SELECT to_regclass('public.$table') IS NOT NULL")
  [ "$exists" = "t" ] || { echo "FAIL: missing restored table" >&2; exit 1; }
done
echo "PASS: restored gateway schema and state tables present"
echo "PASS: source untouched, isolated destination restored from pg_dump archive"
