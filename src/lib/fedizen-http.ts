/**
 * How Atlas's server introduces itself to fedizen.net. Fedizen is hosted on DreamHost (fedizen.net A
 * 208.113.210.203, SOA ns1.dreamhost.com), whose web firewall commonly refuses requests that carry no User-Agent.
 * Cloudflare Workers, where Atlas runs, send none unless asked (Node and Bun, which run Atlas's CI probes, send
 * their own), so every request to Fedizen names Atlas.
 */
export const FEDIZEN_USER_AGENT = 'Atlas/1.0 (+https://atlas.lovable.app; Fedizen client)';

/** A transport failure, described for logs without anything from the request (no URL, token or body). */
export function transportDetail(e: unknown): string {
  if (!(e instanceof Error)) return 'unknown';
  const cause = (e as { cause?: unknown }).cause;
  const inner = cause instanceof Error ? ` ← ${cause.name}: ${cause.message}` : '';
  return `${e.name}: ${e.message}${inner}`.replace(/Bearer\s+\S+/gi, 'Bearer …').slice(0, 300);
}
