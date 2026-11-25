# Atlas's private Durable Streams server (the assistant's kept answers: src/lib/assistant/durable.server.ts).
# Built from source at a pinned commit of the upstream repository: tag caddy-v0.3.0 of
# https://github.com/durable-streams/durable-streams (packages/caddy-plugin, Apache-2.0). Change DS_COMMIT to upgrade.
FROM golang:1.25-alpine3.22 AS build
ARG DS_COMMIT=0483b435d30b6a60759df5ee2fe21983c7d65eba
RUN apk add --no-cache git
WORKDIR /src
RUN git init -q && git remote add origin https://github.com/durable-streams/durable-streams.git \
 && git fetch -q --depth 1 origin "$DS_COMMIT" && git checkout -q --detach FETCH_HEAD \
 && test "$(git rev-parse HEAD)" = "$DS_COMMIT"
WORKDIR /src/packages/caddy-plugin
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/durable-streams-server ./cmd/caddy

FROM alpine:3.22
RUN apk add --no-cache ca-certificates
COPY --from=build /out/durable-streams-server /usr/local/bin/durable-streams-server
COPY Caddyfile /etc/durable-streams/Caddyfile
COPY start.sh /usr/local/bin/start.sh
RUN chmod +x /usr/local/bin/start.sh
EXPOSE 4437
CMD ["/usr/local/bin/start.sh"]
