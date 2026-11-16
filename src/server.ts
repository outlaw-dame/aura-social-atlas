import "./lib/error-capture";

import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

let serverEntryPromise: Promise<ServerEntry> | undefined;

async function getServerEntry(): Promise<ServerEntry> {
  if (!serverEntryPromise) {
    serverEntryPromise = import("@tanstack/react-start/server-entry").then(
      (m) => (m.default ?? m) as ServerEntry,
    );
  }
  return serverEntryPromise;
}

// h3 swallows in-handler throws into a normal 500 Response with body
// {"unhandled":true,"message":"HTTPError"} — try/catch alone never fires for those.
async function normalizeCatastrophicSsrResponse(response: Response): Promise<Response> {
  if (response.status < 500) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  const body = await response.clone().text();
  if (!body.includes('"unhandled":true') || !body.includes('"message":"HTTPError"')) {
    return response;
  }

  console.error(consumeLastCapturedError() ?? new Error(`h3 swallowed SSR error: ${body}`));
  return new Response(renderErrorPage(), {
    status: 500,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

/**
 * Baseline hardening for pages. A strict script-src would need a nonce on every hydration script TanStack Start
 * inlines, and a connect-src allowlist would break federated video (hls.js fetches manifests from any PeerTube host),
 * so the policy covers what's safe everywhere: no plugins, no <base> hijacking, no MIME sniffing, and no full URLs in
 * the Referer sent to other sites. Keys kept on the device stay a readable-by-the-page trade-off, which Settings says.
 */
function withSecurityHeaders(response: Response): Response {
  if (!(response.headers.get("content-type") ?? "").includes("text/html")) return response;
  const out = new Response(response.body, response);
  if (!out.headers.has("content-security-policy")) out.headers.set("content-security-policy", "object-src 'none'; base-uri 'self'");
  out.headers.set("x-content-type-options", "nosniff");
  if (!out.headers.has("referrer-policy")) out.headers.set("referrer-policy", "strict-origin-when-cross-origin");
  return out;
}

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    try {
      const handler = await getServerEntry();
      const response = await handler.fetch(request, env, ctx);
      return withSecurityHeaders(await normalizeCatastrophicSsrResponse(response));
    } catch (error) {
      console.error(error);
      return new Response(renderErrorPage(), {
        status: 500,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
  },
};
