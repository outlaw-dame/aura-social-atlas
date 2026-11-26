/**
 * Servers the person blocks, kept by Atlas (atlas_blocked_servers). Fedizen (Bonfire) gives apps no list of the servers
 * a person blocks there, so Atlas can't tell when a post, reply or Spotlight card comes from one. This list is Atlas's
 * own, added to by hand or imported from a file, and Atlas hides posts from these servers wherever it shows them.
 * Fedizen doesn't know about it: servers blocked on Fedizen are still managed there.
 *
 * Browser-safe and pure, so the settings page can show what a file holds and the server keeps exactly the same.
 *
 * Files it reads (the formats blocklists are published in):
 * - Mastodon's CSV, as exported by Mastodon 4.1+ (Moderation → Federation) and used by FediBlockHole, IFTAS CARIAD and
 *   GoToSocial's subscriptions: a header `#domain,#severity,#reject_media,#reject_reports,#public_comment,#obfuscate`
 *   (the `#` optional), one server a row. Only `suspend` rows are blocks; `silence` (limit) and `noop` rows are
 *   skipped, as GoToSocial's subscriptions do.
 * - Plain text, or Mastodon's own "Domain blocks" export: one server a line, no header (RapidBlock's CSV too).
 * - JSON: an array of servers, or of objects with `domain` (Mastodon's API shape; `severity` read as above).
 * Lines starting with `#` (comments) and blank lines are ignored. `*.example.com` blocks example.com and everything
 * under it, as every server name does here. A name hidden with `*` in the middle (Mastodon's "obfuscate") can't be
 * matched and is skipped; so is anything that isn't a server name.
 */

export const MAX_BLOCKED_SERVERS = 10_000;
/** The largest file read, in characters (CARIAD's Omnibus list, the largest common one, is well under this). */
export const MAX_BLOCKLIST_CHARS = 2_000_000;

export type SkipReason = 'limited' | 'hidden' | 'invalid';
export type ParsedBlocklist = { domains: string[]; skipped: Record<SkipReason, number> };

/**
 * A server name as Atlas keeps it: lowercase, its international form (münchen.social → xn--mnchen-3ya.social), no
 * `*.`/leading dot, no port, no trailing dot. Also takes an address (https://example.social/about). Null if it isn't one.
 */
export function normalizeServer(raw: string): string | null {
  let s = raw.trim().toLowerCase();
  if (!s) return null;
  if (/^[a-z][a-z0-9+.-]*:\/\//.test(s)) {
    try { s = new URL(s).hostname; } catch { return null; }
  }
  s = s.replace(/^\*\./, '').replace(/^\./, '').replace(/\.$/, '');
  if (!s || s.length > 253 || /[\s/@:*?#[\]\\]/.test(s)) return null;
  let host: string;
  try { host = new URL(`https://${s}/`).hostname; } catch { return null; }
  if (host !== host.toLowerCase() || !host.includes('.') || host.startsWith('.') || host.endsWith('.')) return null;
  // Not an address: an IP isn't a server name people block by, and a bare number is a mistake.
  if (/^\d+(\.\d+)*$/.test(host) || host.startsWith('[')) return null;
  if (!host.split('.').every(l => /^[a-z0-9-]{1,63}$/.test(l) && !l.startsWith('-') && !l.endsWith('-'))) return null;
  return host;
}

/** Whether a row's severity makes it a block: `suspend`, or no severity at all. */
function blocks(severity: unknown): boolean | 'limited' {
  if (severity === undefined || severity === null || severity === '') return true;
  const s = String(severity).trim().toLowerCase();
  return s === 'suspend' ? true : 'limited';
}

/** One CSV row's fields (quotes and doubled quotes as RFC 4180). */
function csvFields(line: string): string[] {
  const out: string[] = [];
  let cur = '', quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') quoted = false;
      else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out.map(f => f.trim());
}

/** What a blocklist file holds: its servers (lowercase, each once, in file order) and how many rows were skipped why. */
export function parseBlocklist(text: string): ParsedBlocklist {
  const skipped: Record<SkipReason, number> = { limited: 0, hidden: 0, invalid: 0 };
  const seen = new Set<string>(), domains: string[] = [];
  const add = (raw: unknown, severity?: unknown) => {
    if (typeof raw !== 'string') { skipped.invalid++; return; }
    const b = blocks(severity);
    if (b === 'limited') { skipped.limited++; return; }
    const trimmed = raw.trim().replace(/^\*\./, '');
    if (trimmed.includes('*')) { skipped.hidden++; return; }
    const d = normalizeServer(trimmed);
    if (!d) { skipped.invalid++; return; }
    if (!seen.has(d)) { seen.add(d); domains.push(d); }
  };
  const body = text.slice(0, MAX_BLOCKLIST_CHARS).replace(/^﻿/, '');

  if (/^\s*\[/.test(body)) {
    let json: unknown;
    try { json = JSON.parse(body); } catch { json = null; }
    if (Array.isArray(json)) {
      for (const item of json) {
        if (typeof item === 'string') add(item);
        else if (item && typeof item === 'object') add((item as { domain?: unknown }).domain, (item as { severity?: unknown }).severity);
        else skipped.invalid++;
      }
      return { domains, skipped };
    }
  }

  const lines = body.split(/\r\n|\r|\n/);
  let domainCol = -1, severityCol = -1;
  let i = 0;
  // A header names its columns: Mastodon's `#domain,#severity,…`, or plain `domain,severity,…`.
  while (i < lines.length && !lines[i]!.trim()) i++;
  const first = lines[i] !== undefined ? csvFields(lines[i]!).map(f => f.replace(/^#/, '').toLowerCase()) : [];
  if (first.includes('domain')) {
    domainCol = first.indexOf('domain');
    severityCol = first.indexOf('severity');
    i++;
  }
  for (; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (!line || (domainCol < 0 && line.startsWith('#')) || line.startsWith('//')) continue;
    const fields = csvFields(line);
    if (domainCol >= 0) add(fields[domainCol] ?? '', severityCol >= 0 ? fields[severityCol] : undefined);
    else add(fields[0] ?? '');
  }
  return { domains, skipped };
}

/** The list as Mastodon's CSV (every row a `suspend`), to keep or take to another app. */
export function blocklistCsv(domains: readonly string[]): string {
  return ['#domain,#severity,#reject_media,#reject_reports,#public_comment,#obfuscate', ...domains.map(d => `${d},suspend,false,false,,false`)].join('\n') + '\n';
}

/** Whether `host` is one of `servers` or under one (social.example is under example). */
export function serverBlocked(host: string | null | undefined, servers: ReadonlySet<string>): boolean {
  if (!host || !servers.size) return false;
  let h = host.toLowerCase().replace(/\.$/, '');
  for (;;) {
    if (servers.has(h)) return true;
    const dot = h.indexOf('.');
    if (dot < 0) return false;
    h = h.slice(dot + 1);
  }
}

/** The server of a handle (`@ann@example.social`, `ann@example.social`), or of a local one (`ann`: Fedizen's). */
export function serverOfHandle(handle: string | null | undefined): string | null {
  const h = (handle ?? '').trim().replace(/^@/, '');
  if (!h) return null;
  const at = h.lastIndexOf('@');
  return at < 0 ? 'fedizen.net' : h.slice(at + 1).toLowerCase() || null;
}

/** The servers a post comes from, for hiding: its author's, and its booster's for a boost. */
export function postServers(p: { acct?: string; handle?: string; booster?: { acct?: string; handle?: string } }): string[] {
  const out = [serverOfHandle(p.acct ?? p.handle)];
  if (p.booster) out.push(serverOfHandle(p.booster.acct ?? p.booster.handle));
  return out.filter((s): s is string => !!s);
}

/** The first of a post's servers that's blocked, if any. */
export function blockedServerOf(p: Parameters<typeof postServers>[0], servers: ReadonlySet<string>): string | null {
  if (!servers.size) return null;
  return postServers(p).find(s => serverBlocked(s, servers)) ?? null;
}
