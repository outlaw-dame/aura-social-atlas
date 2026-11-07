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

if [[ "${ATLAS_BACKUP_CI_LOCAL:-}" == "1" ]]; then
  # An intentionally isolated GitHub runner test. Cannot select a remote or
  # production DB even when someone copies this environment accidentally.
  [[ "${CI:-}" == "true" && "$SOURCE_DATABASE_URL" == *"@127.0.0.1:"* &&
     "$BACKUP_REMOTE" == /scratch/objects ]] || {
    echo "backup.refused_unsafe_local_ci_configuration" >&2; exit 2;
  }
else
  [[ "${RAILWAY_ENVIRONMENT_NAME:-}" == "staging" &&
     "$SOURCE_DATABASE_URL" == *".railway.internal"* &&
     "$BACKUP_REMOTE" == r2:* &&
     -n "${RCLONE_CONFIG_R2_ACCESS_KEY_ID:-}" &&
     -n "${RCLONE_CONFIG_R2_SECRET_ACCESS_KEY:-}" &&
     -n "${RCLONE_CONFIG_R2_ENDPOINT:-}" ]] || {
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
