/**
 * Reading the lists people bring from another account, so Atlas can redo them on Fedizen.
 *
 * Mastodon's "Data export" (Preferences → Import and export → Data export; app/models/export.rb) gives one CSV per
 * list:
 *   following_accounts.csv   header "Account address,Show boosts,Notify on new posts,Languages"
 *   muted_accounts.csv       header "Account address,Hide notifications"
 *   blocked_accounts.csv     one handle per line, no header
 *   lists.csv                "list name,handle" per line, no header
 *   blocked_domains.csv      one domain per line, no header
 *   bookmarks.csv            one post URL per line, no header
 * and filters as JSON (custom_filters, read by content-filter.ts). Bonfire's export (export_controller.ex) uses the same
 * shapes: following.csv / blocked.csv / silenced.csv / ghosted.csv with the "Account address" header, circles.csv as
 * "circle name,handle". Atlas can redo follows, blocks, mutes and lists (circles) through Fedizen's API; Fedizen's API
 * has no way to block a whole server or to find a post by its address, so domain blocks and bookmarks are left to
 * Fedizen's own importer.
 */
import { FEDIZEN, lookupAcct } from './fedizen-feed';

export type ImportKind = 'following' | 'blocks' | 'mutes' | 'lists' | 'domain-blocks' | 'bookmarks' | 'filters' | 'unknown';
/** Kinds Atlas can carry out itself. */
export const DOABLE: readonly ImportKind[] = ['following', 'blocks', 'mutes', 'lists', 'filters'];

export type ImportFile =
  | { kind: 'following' | 'blocks' | 'mutes'; accounts: string[]; skipped: number }
  | { kind: 'lists'; members: { list: string; account: string }[]; skipped: number }
  | { kind: 'domain-blocks'; domains: string[] }
  | { kind: 'bookmarks'; urls: string[] }
  | { kind: 'filters'; text: string }
  | { kind: 'unknown' };

/** Most people a single import will work through; Mastodon caps follows at 7,500 and imports at 20 MB. */
export const MAX_IMPORT_ROWS = 7500;

/** RFC 4180 rows: quoted fields may hold commas, doubled quotes and line breaks. Blank lines are dropped. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], field = '', quoted = false;
  const s = text.replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"' && s[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"' && field === '') quoted = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && s[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some(f => f.trim())) rows.push(row.map(f => f.trim()));
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some(f => f.trim())) rows.push(row.map(f => f.trim()));
  return rows;
}

const isHeader = (row: string[]) => /^account address$/i.test(row[0] ?? '') || /^(list|circle) name$/i.test(row[0] ?? '');
const isUrl = (v: string) => /^https?:\/\/\S+$/i.test(v);
const isDomain = (v: string) => /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(v);
const acctOf = (v: string) => { const a = lookupAcct(v); return a && a.includes('@') ? a.toLowerCase() : null; };

/** The kind a file name names (Mastodon's and Bonfire's export names), if any. */
export function kindFromName(name: string): ImportKind | null {
  const n = name.toLowerCase();
  if (/follow/.test(n) && !/followers|requests/.test(n)) return 'following';
  if (/blocked_domains|domain/.test(n)) return 'domain-blocks';
  if (/block|ghost/.test(n)) return 'blocks';
  if (/mute|silence/.test(n)) return 'mutes';
  if (/lists|circles/.test(n)) return 'lists';
  if (/bookmark/.test(n)) return 'bookmarks';
  if (/filter/.test(n) || n.endsWith('.json')) return 'filters';
  return null;
}

/**
 * What a file holds and the rows Atlas will act on: by its name where the name says (as exported), else by what its
 * rows look like. Handles are kept only in full form (name@server), lower-cased and without repeats; anything else is
 * counted in `skipped`.
 */
export function readImport(name: string, text: string, chosen?: 'following' | 'blocks' | 'mutes'): ImportFile {
  const t = text.trim();
  if (t.startsWith('{')) {
    try { if (Array.isArray((JSON.parse(t) as { custom_filters?: unknown }).custom_filters)) return { kind: 'filters', text: t }; } catch { /* not JSON */ }
    return { kind: 'unknown' };
  }
  const rows = parseCsv(t).slice(0, MAX_IMPORT_ROWS + 1);
  const body = rows.length && isHeader(rows[0]) ? rows.slice(1) : rows;
  if (!body.length) return { kind: 'unknown' };
  const named = kindFromName(name);
  const firsts = body.map(r => r[0]);
  const guess: ImportKind = named && named !== 'filters' ? named
    : firsts.every(isUrl) ? 'bookmarks'
    : firsts.every(isDomain) ? 'domain-blocks'
    : body.every(r => r.length >= 2 && !acctOf(r[0]) && !!acctOf(r[1])) ? 'lists'
    : firsts.some(v => !!acctOf(v)) ? 'following' : 'unknown';
  const kind = chosen && (guess === 'following' || guess === 'blocks' || guess === 'mutes') ? chosen : guess;
  if (kind === 'bookmarks') return { kind, urls: [...new Set(firsts.filter(isUrl))] };
  if (kind === 'domain-blocks') return { kind, domains: [...new Set(firsts.filter(isDomain).map(d => d.toLowerCase()))] };
  if (kind === 'lists') {
    const seen = new Set<string>(), members: { list: string; account: string }[] = [];
    let skipped = 0;
    for (const r of body) {
      const list = (r[0] ?? '').slice(0, 100), account = acctOf(r[1] ?? '');
      if (!list || !account) { skipped++; continue; }
      const k = `${list}\n${account}`;
      if (!seen.has(k)) { seen.add(k); members.push({ list, account }); }
    }
    return { kind, members: members.slice(0, MAX_IMPORT_ROWS), skipped };
  }
  if (kind === 'following' || kind === 'blocks' || kind === 'mutes') {
    const seen = new Set<string>();
    let skipped = 0;
    for (const v of firsts) { const a = acctOf(v); if (a) seen.add(a); else skipped++; }
    return { kind, accounts: [...seen].slice(0, MAX_IMPORT_ROWS), skipped };
  }
  return { kind: 'unknown' };
}

/** How many things a file asks for, for its summary line. */
export function importSize(f: ImportFile): number {
  switch (f.kind) {
    case 'following': case 'blocks': case 'mutes': return f.accounts.length;
    case 'lists': return f.members.length;
    case 'domain-blocks': return f.domains.length;
    case 'bookmarks': return f.urls.length;
    default: return 0;
  }
}

/** Fedizen's own importer (Settings → Import), for what its API can't do. */
export const FEDIZEN_IMPORT_URL = `${FEDIZEN}/settings/user/import`;

/** How each kind reads in the list of files, and what Import does with it. */
export const KIND_LABEL: Record<ImportKind, { title: string; verb: string }> = {
  following: { title: 'People to follow', verb: 'Follow' },
  blocks: { title: 'People to block', verb: 'Block' },
  mutes: { title: 'People to mute', verb: 'Mute' },
  lists: { title: 'Lists, as circles', verb: 'Add to circles' },
  filters: { title: 'Keyword filters', verb: 'Add filters' },
  'domain-blocks': { title: 'Blocked servers', verb: '' },
  bookmarks: { title: 'Bookmarks', verb: '' },
  unknown: { title: 'Not a file Atlas can read', verb: '' },
};

/** Why a kind isn't carried out in Atlas, and where it can be. */
export const NOT_HERE: Partial<Record<ImportKind, string>> = {
  'domain-blocks': 'Fedizen’s API can’t block a whole server yet. Import this file on Fedizen instead.',
  bookmarks: 'Fedizen’s API can’t find a post by its address, so Atlas can’t save these. Import this file on Fedizen instead.',
  unknown: 'Atlas reads Mastodon’s and Bonfire’s exports: follows, blocks, mutes, lists and filters.',
};
