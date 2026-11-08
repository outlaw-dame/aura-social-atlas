#!/usr/bin/env bash
# Restores only a manifest-verified, age-decrypted logical archive into an
# independently provisioned EMPTY PostgreSQL database. Never run on source.
set -euo pipefail
umask 077
: "${RECOVERY_ARCHIVE:?ciphertext file required}"
: "${RECOVERY_MANIFEST:?manifest file required}"
: "${AGE_IDENTITY_PATH:?offline age identity path required}"
: "${RESTORE_DATABASE_URL:?isolated restore DSN required}"
[[ "${RECOVERY_CONFIRM:-}" == "isolated-empty-target" ]] || {
  echo "restore.refused_missing_confirmation" >&2; exit 2;
}
# Strict libpq URI host; reject query/fragment overrides, no logged secrets.
private_restore_host() {
  local dsn="$RESTORE_DATABASE_URL"
  [[ "$dsn" =~ ^postgres(ql)?://[^/@?#[:space:]]+@([a-zA-Z0-9-]+\.)+railway\.internal:5432/[^?#[:space:]]+$ ]] &&
    [[ -z "${PGHOSTADDR:-}" && -z "${PGSERVICE:-}" ]]
}
ci_local_restore_host() {
  local dsn="$RESTORE_DATABASE_URL"
  [[ "$dsn" =~ ^postgres(ql)?://[^/@?#[:space:]]+@127\.0\.0\.1:5433/[^?#[:space:]]+$ ]] &&
    [[ -z "${PGHOSTADDR:-}" && -z "${PGSERVICE:-}" ]]
}
if [[ "${ATLAS_BACKUP_CI_LOCAL:-}" == "1" ]]; then
  [[ "${CI:-}" == "true" ]] && ci_local_restore_host || {
    echo "restore.refused_unsafe_local_target" >&2; exit 2;
  }
else
  [[ "${RAILWAY_ENVIRONMENT_NAME:-}" == "staging" ]] && private_restore_host || {
    echo "restore.refused_nonprivate_or_nonstaging" >&2; exit 2;
  }
fi

[[ -f "$RECOVERY_ARCHIVE" && -f "$RECOVERY_MANIFEST" && -f "$AGE_IDENTITY_PATH" ]] || {
  echo "restore.missing_files" >&2; exit 2;
}
# Strict manifest: expected version, exact checksum and nonzero byte count.
jq -e 'type=="object" and .version==1 and (.createdUtc|type=="string") and
       (.ciphertextSha256|type=="string" and test("^[0-9a-f]{64}$")) and
       (.ciphertextBytes|type=="number" and .>0 and floor==.)' "$RECOVERY_MANIFEST" >/dev/null || {
  echo "restore.invalid_manifest" >&2; exit 2;
}
expected_sha="$(jq -r .ciphertextSha256 "$RECOVERY_MANIFEST")"
expected_size="$(jq -r .ciphertextBytes "$RECOVERY_MANIFEST")"
actual_sha="$(sha256sum "$RECOVERY_ARCHIVE" | awk '{print $1}')"
actual_size="$(wc -c < "$RECOVERY_ARCHIVE" | tr -d ' ')"
[[ "$expected_sha" == "$actual_sha" && "$expected_size" == "$actual_size" ]] || {
  echo "restore.ciphertext_integrity_mismatch" >&2; exit 2;
}
echo "restore.ciphertext_integrity_verified"
# Never touch a nonempty target, including a target without gateway tables.
count="$(psql "$RESTORE_DATABASE_URL" -XAt -v ON_ERROR_STOP=1 -c "
 SELECT
   (SELECT count(*) FROM pg_namespace
    WHERE nspname NOT IN ('public', 'information_schema')
      AND nspname NOT LIKE 'pg_%')
   + (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public')
   + (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public')
   + (SELECT count(*) FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace
      WHERE n.nspname='public' AND t.typtype IN ('e','d','r'))
   + (SELECT count(*) FROM pg_extension WHERE extname <> 'plpgsql')
   + (SELECT count(*) FROM pg_event_trigger);
")"
[[ "$count" == "0" ]] || {
  echo "restore.refused_nonempty_database" >&2; exit 2;
}
tmpdir="$(mktemp -d)"
trap 'rm -rf -- "$tmpdir"' EXIT
dump="$tmpdir/verified.pgcustom"
age --decrypt --identity "$AGE_IDENTITY_PATH" --output "$dump" "$RECOVERY_ARCHIVE"
pg_restore --list "$dump" >/dev/null
echo "restore.decrypted_archive_verified"
pg_restore --dbname="$RESTORE_DATABASE_URL" --no-owner --no-acl --exit-on-error "$dump"
# Fail on missing core identity/state tables.
for tab in gateway_keys gateway_subscriptions; do
  found="$(psql "$RESTORE_DATABASE_URL" -XAt -v ON_ERROR_STOP=1 \
    -c "SELECT to_regclass('public.$tab') IS NOT NULL")"
  [[ "$found" == t ]] || { echo "restore.missing_essential_table" >&2; exit 1; }
done
echo "restore.completed"
