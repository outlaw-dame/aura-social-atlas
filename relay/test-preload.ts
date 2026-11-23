/**
 * Loaded before every relay test (bunfig.toml). Replaces fetch so no test can reach the internet:
 * POSTs are recorded and answered locally, every other request fails. Fedify pins DNS and sends to an
 * IP literal with the original Host header, so we record the logical URL.
 *
 * DNS is answered here too: before delivering, Fedify resolves the inbox's host and refuses private or unresolvable
 * ones (@fedify/relay lookupAllAddresses, which looks `dns.lookup` up on every call "so that tests can still stub" it).
 * Without this the tests needed working DNS, and failed wherever there is none (a sandbox, an offline laptop). The test
 * hosts get a fixed public address that is never contacted (fetch above answers instead); any other name fails.
 */
import dns from 'node:dns/promises';

const TEST_HOSTS = new Set(['fedizen.net', 'mastodon.social', 'bonfire.example']);
const NEVER_CONTACTED = '93.184.215.14';
dns.lookup = (async (hostname: string, options?: { all?: boolean }) => {
  if (!TEST_HOSTS.has(hostname)) throw Object.assign(new Error(`DNS disabled in tests: ${hostname}`), { code: 'ENOTFOUND' });
  const address = { address: NEVER_CONTACTED, family: 4 };
  return options?.all ? [address] : address;
}) as typeof dns.lookup;
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
