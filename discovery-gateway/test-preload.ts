/**
 * Loaded before every gateway test (bunfig.toml). Replaces fetch so no test can reach the
 * internet: POSTs are recorded and answered locally, every other request fails. Fedify pins
 * DNS and sends to an IP literal with the original Host header, so we record the logical URL.
 */
export const delivered: { url: string; body: Record<string, unknown> }[] = [];
export const blocked: string[] = [];
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const req = new Request(input, init);
  const u = new URL(req.url); const host = req.headers.get('host') ?? u.host;
  const url = `${u.protocol}//${host}${u.pathname}`;
  if (req.method === 'POST') { delivered.push({ url, body: await req.json().catch(() => ({})) }); return new Response(null, { status: 202 }); }
  blocked.push(url);
  throw new TypeError(`network disabled in tests: ${url}`);
}) as typeof fetch;
