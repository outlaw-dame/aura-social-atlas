/** Imported first by the signed e2e test so no request ever leaves the machine: POSTs are captured, everything else fails. */
export const delivered: { url: string; body: Record<string, unknown> }[] = [];
export const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const req = new Request(input, init);
  if (req.method === 'POST') { delivered.push({ url: req.url, body: await req.json() }); return new Response(null, { status: 202 }); }
  return new Response('blocked in tests', { status: 404 });
}) as typeof fetch;
