import { createFileRoute } from "@tanstack/react-router";

/** When this server process started, to tell a fresh start from one that stayed up. */
const STARTED = Date.now();

/**
 * GET/HEAD /api/health: whether Atlas's server is up, for Railway's healthcheck. It touches nothing else (no Fedizen,
 * no Supabase, no page render), so it costs almost nothing and can't be slowed or failed by Fedizen. Nothing about any
 * account; never cached.
 */
function health(method: "GET" | "HEAD") {
  const body = JSON.stringify({ ok: true, uptimeSeconds: Math.round((Date.now() - STARTED) / 1000) });
  return new Response(method === "HEAD" ? null : body, {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-robots-tag": "noindex",
    },
  });
}

export const Route = createFileRoute("/api/health")({
  server: {
    handlers: {
      GET: async () => health("GET"),
      HEAD: async () => health("HEAD"),
    },
  },
});
