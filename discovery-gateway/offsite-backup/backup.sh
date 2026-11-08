#!/usr/bin/env bash
# One-shot, encrypted PostgreSQL logical backup to private S3-compatible object storage.
# No decryption key is present in this container; plaintext only exists in ephemeral /tmp.
set -euo pipefail
umask 077

: "${SOURCE_DATABASE_URL:?required private Postgres DSN}"
: "${AGE_RECIPIENT:?required age recipient public key}"
: "${BACKUP_REMOTE:?required rclone destination}"
if ! [[ "$AGE_RECIPIENT" =~ ^age1[0-9a-z]{50,65}$ ]]; then
  echo "backup.refused_invalid_encryption_recipient" >&2
  exit 2
fi

# Fail closed on libpq URI parameters: query-string host/hostaddr/service
# overrides can silently redirect pg_dump away from the URI authority.
# This intentionally admits only a simple URI with an explicit host/port,
# with no query or fragment. Percent-encode special characters in credentials.
# Never print the DSN (it includes a database password).
private_db_host() {
  local dsn="$SOURCE_DATABASE_URL"
  [[ "$dsn" =~ ^postgres(ql)?://[^/@?#[:space:]]+@([a-zA-Z0-9-]+\.)+railway\.internal:5432/[^?#[:space:]]+$ ]] &&
    [[ -z "${PGHOSTADDR:-}" && -z "${PGSERVICE:-}" ]]
}
ci_local_db_host() {
  local dsn="$SOURCE_DATABASE_URL"
  [[ "$dsn" =~ ^postgres(ql)?://[^/@?#[:space:]]+@127\.0\.0\.1:5432/[^?#[:space:]]+$ ]] &&
    [[ -z "${PGHOSTADDR:-}" && -z "${PGSERVICE:-}" ]]
}

if [[ "${ATLAS_BACKUP_CI_LOCAL:-}" == "1" ]]; then
  # An intentionally isolated GitHub runner test. Cannot select a remote or
  # production DB even when someone copies this environment accidentally.
  [[ "${CI:-}" == "true" && "$BACKUP_REMOTE" == /scratch/objects ]] && ci_local_db_host || {
    echo "backup.refused_unsafe_local_ci_configuration" >&2; exit 2;
  }
else
  [[ "${RAILWAY_ENVIRONMENT_NAME:-}" == "staging" &&
     "$BACKUP_REMOTE" == "r2:atlas-discovery-staging-backups" &&
     -n "${RCLONE_CONFIG_R2_ACCESS_KEY_ID:-}" &&
     -n "${RCLONE_CONFIG_R2_SECRET_ACCESS_KEY:-}" &&
     -n "${RCLONE_CONFIG_R2_ENDPOINT:-}" ]] && private_db_host || {
    echo "backup.refused_missing_private_staging_or_r2_configuration" >&2; exit 2;
  }
fi

tmpdir="$(mktemp -d)"
trap 'rm -rf -- "$tmpdir"' EXIT
dump="$tmpdir/backup.pgcustom"
encrypted="$tmpdir/backup.age"
manifest="$tmpdir/manifest.json"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
nonce="$(od -An -N8 -tx1 /dev/urandom | tr -d ' \n')"
key="gateway-staging/${stamp}-${nonce}.pgcustom.age"
remote="${BACKUP_REMOTE%/}/$key"

pg_dump "$SOURCE_DATABASE_URL" --format=custom --no-owner --no-acl --file="$dump"
[[ -s "$dump" ]] || { echo "backup.refused_empty_dump" >&2; exit 1; }
pg_restore --list "$dump" >/dev/null
echo "backup.dump_verified"

age --recipient "$AGE_RECIPIENT" --output "$encrypted" "$dump"
[[ -s "$encrypted" ]] || { echo "backup.refused_empty_ciphertext" >&2; exit 1; }
checksum="$(sha256sum "$encrypted" | awk '{print $1}')"
bytes="$(wc -c < "$encrypted" | tr -d ' ')"
# Bounded rclone retries; no output may contain S3 keys or SQL records.
rclone --retries 3 --low-level-retries 3 copyto "$encrypted" "$remote"
readback="$(rclone --retries 3 --low-level-retries 3 cat "$remote" | sha256sum | awk '{print $1}')"
[[ "$checksum" == "$readback" ]] || {
  echo "backup.remote_ciphertext_mismatch" >&2
  exit 1
}
echo "backup.ciphertext_verified"

printf '{"version":1,"createdUtc":"%s","ciphertextSha256":"%s","ciphertextBytes":%s}\n' \
  "$stamp" "$checksum" "$bytes" > "$manifest"
rclone --retries 3 --low-level-retries 3 copyto "$manifest" "$remote.manifest.json"
echo "backup.completed encrypted_bytes=$bytes"
