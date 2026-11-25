# Durable Streams server (private)

Keeps the assistant's answers as they're generated, so a refresh, a dropped connection or another device picks an
answer up where it is (`src/lib/assistant/durable.server.ts`). [Durable Streams](https://github.com/durable-streams/durable-streams)
is an open HTTP protocol for append-only streams that readers resume from an offset; this is its Caddy-based server.

## Railway service

- Source: this repository, root directory `infra/durable-streams` (the Dockerfile here builds the server from a pinned
  upstream commit), watch paths `infra/durable-streams/**`.
- **No public domain.** Atlas reaches it over the private network; browsers read only through Atlas's
  `/api/assistant/stream/$id`, which checks who's asking.
- Volume mounted at `/data` (streams live in `/data/streams`).
- Variables: `DS_TOKEN` (32+ letters, digits, `-`, `_`), `PORT=4437`. Healthcheck `/healthz`.
- Atlas's service gets `ATLAS_DURABLE_STREAMS_URL=http://<private name>.railway.internal:4437/v1/stream` and
  `ATLAS_DURABLE_STREAMS_TOKEN` (the same token). Without them the assistant answers the old way.

Streams expire 24 h after their last read or write (`Stream-TTL`, set by Atlas).
