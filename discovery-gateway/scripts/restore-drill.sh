#!/usr/bin/env bash
# CI-only logical backup/restore drill. Source is GitHub Actions' disposable
# PostgreSQL; never use a live gateway or Fedizen database.
set -euo pipefail
: "${GATEWAY_TEST_DATABASE_URL:?A disposable CI database is required}"
case "$GATEWAY_TEST_DATABASE_URL" in
  *127.0.0.1:5432/gateway_integration) ;;
  *) echo "Refusing a non-CI database" >&2; exit 2 ;;
esac
backup="$(mktemp)"
trap 'rm -f "$backup"' EXIT
restore_url="${GATEWAY_TEST_DATABASE_URL%/*}/gateway_restore_verify"
psql "$GATEWAY_TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -q \
  -c 'CREATE DATABASE gateway_restore_verify'
pg_dump "$GATEWAY_TEST_DATABASE_URL" --format=custom --no-owner --no-acl \
  --file="$backup"
test -s "$backup"
pg_restore --no-owner --no-acl --exit-on-error \
  --dbname="$restore_url" "$backup"

# Compare complete JSON representations, including the private/public key
# pair. Only salted-independent digests are held within this transient process;
# never print key material or row contents.
for table in gateway_keys gateway_subscriptions gateway_items gateway_seen; do
  sql="SELECT md5(COALESCE(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text)::text, '[]')) FROM ${table} t"
  source_digest="$(psql "$GATEWAY_TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -At -c "$sql")"
  restore_digest="$(psql "$restore_url" -v ON_ERROR_STOP=1 -At -c "$sql")"
  if [[ -z "$source_digest" || "$source_digest" != "$restore_digest" ]]; then
    echo "Restore verification failed for table: $table" >&2
    exit 1
  fi
done
key_count="$(psql "$restore_url" -v ON_ERROR_STOP=1 -At -c 'SELECT count(*) FROM gateway_keys')"
if (( key_count < 1 )); then
  echo "Restore contained no signing key to verify" >&2
  exit 1
fi
echo "PASS: isolated logical backup/restore and actor-key/data integrity"
