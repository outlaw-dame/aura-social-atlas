/**
 * SSRF guards for operator-supplied URLs (subscription targets) and for URLs
 * carried in inbound activities. Two layers:
 *
 *  1. Syntactic validation here: https only, no credentials, no IP-literal or
 *     otherwise suspicious hosts, no non-default ports, well-formed hostname.
 *  2. Network-level validation at fetch time: every remote fetch goes through
 *     Fedify document loaders configured with `allowPrivateAddress: false`,
 *     which resolves DNS and rejects private/loopback/reserved addresses on
 *     every redirect hop. Never fetch with a bare `fetch()`.
 */

const BLOCKED_HOSTNAMES = new Set(['localhost', 'localhost.localdomain', 'broadcasthost', 'ip6-localhost', 'ip6-loopback']);

/** Hostnames that are decimal/hex/octal IPv4 or any IPv6 literal. */
function isIpLiteral(host: string): boolean {
  if (host.startsWith('[') || host.includes(':')) return true; // IPv6
  if (/^\d+$/.test(host)) return true; // decimal IPv4 like 2130706433
  if (/^(0x[0-9a-f]+)(\.|$)/i.test(host)) return true; // hex IPv4
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host); // dotted IPv4 (validated by DNS layer too)
}

export type UrlCheck = { ok: true; url: URL } | { ok: false; reason: string };

export function checkRemoteUrl(input: string | URL): UrlCheck {
  let url: URL;
  try { url = typeof input === 'string' ? new URL(input) : input; } catch { return { ok: false, reason: 'not a valid URL' }; }
  if (url.protocol !== 'https:') return { ok: false, reason: 'only https URLs are accepted' };
  if (url.username || url.password) return { ok: false, reason: 'credentials in URL are not allowed' };
  const host = url.hostname.toLowerCase();
  if (!host) return { ok: false, reason: 'empty host' };
  if (BLOCKED_HOSTNAMES.has(host)) return { ok: false, reason: 'local hostname is not allowed' };
  if (isIpLiteral(host)) return { ok: false, reason: 'IP-literal hosts are not allowed' };
  if (host.endsWith('.local') || host.endsWith('.internal') || host.endsWith('.lan') || host.endsWith('.home.arpa')) {
    return { ok: false, reason: 'local-network hostname is not allowed' };
  }
  if (!/^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/.test(host) || !host.includes('.')) {
    return { ok: false, reason: 'host is not a public DNS name' };
  }
  if (url.port && url.port !== '443') return { ok: false, reason: 'non-default ports are not allowed' };
  return { ok: true, url };
}

/** Origin (scheme://host) of a URL string, or null when invalid. */
export function originOf(input: string | URL | null | undefined): string | null {
  if (input == null) return null;
  try { return new URL(String(input)).origin.toLowerCase(); } catch { return null; }
}

/** Lowercased hostname of a URL string, or null when invalid. */
export function hostOf(input: string | URL | null | undefined): string | null {
  if (input == null) return null;
  try { return new URL(String(input)).hostname.toLowerCase(); } catch { return null; }
}

/**
 * FediBuzz selective relay actor URLs (https://relay.fedi.buzz/):
 *   tag:      https://relay.fedi.buzz/tag/<tag>
 *   instance: https://relay.fedi.buzz/instance/<domain>
 * Tags and domains are strictly validated before interpolation.
 */
export function fediBuzzActorUrl(kind: 'tag' | 'instance', value: string, base = 'https://relay.fedi.buzz'): UrlCheck {
  const baseCheck = checkRemoteUrl(base);
  if (!baseCheck.ok) return baseCheck;
  if (kind === 'tag') {
    const tag = value.replace(/^#/, '').trim().toLowerCase();
    if (!/^[\p{L}\p{N}_-]{1,100}$/u.test(tag)) return { ok: false, reason: 'invalid hashtag' };
    return checkRemoteUrl(`${baseCheck.url.origin}/tag/${encodeURIComponent(tag)}`);
  }
  const domain = value.trim().toLowerCase();
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(domain) || domain.length > 253) {
    return { ok: false, reason: 'invalid instance domain' };
  }
  return checkRemoteUrl(`${baseCheck.url.origin}/instance/${domain}`);
}
