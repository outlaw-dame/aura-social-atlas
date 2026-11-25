#!/bin/sh
# Refuse to start without a real token: the Caddyfile accepts only "Authorization: Bearer $DS_TOKEN".
set -eu
DS_TOKEN="${DS_TOKEN:-}"
if [ "${#DS_TOKEN}" -lt 32 ]; then
  echo "DS_TOKEN must be set to at least 32 characters" >&2
  exit 1
fi
case "$DS_TOKEN" in *[!A-Za-z0-9_-]*) echo "DS_TOKEN may only use letters, digits, - and _" >&2; exit 1 ;; esac
mkdir -p /data/streams
exec /usr/local/bin/durable-streams-server run --config /etc/durable-streams/Caddyfile --adapter caddyfile
