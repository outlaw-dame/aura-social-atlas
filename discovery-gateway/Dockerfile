# Staging gateway image. Both process groups use this immutable build.
# Use the committed gateway bun.lock; fail the build on dependency drift.
FROM oven/bun:1.4.3 AS dependencies
WORKDIR /srv
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

FROM oven/bun:1.4.3-slim
ENV NODE_ENV=production
WORKDIR /srv
COPY --from=dependencies /srv/node_modules ./node_modules
COPY package.json ./package.json
COPY src ./src
USER bun
EXPOSE 4100
CMD ["bun", "src/main.ts"]
