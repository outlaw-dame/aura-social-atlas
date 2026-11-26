import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { withAtlasServers } from '../src/lib/server-blocks.server';
import { hiddenBy } from '../src/components/social/FilterGate';
import { importSummary } from '../src/components/social/useBlockedServers';
import { blockedServerOf, blocklistCsv, normalizeServer, parseBlocklist, serverBlocked } from '../src/lib/server-blocklist';

// Invented names under .example (RFC 2606), never real servers.
describe('blocklist files', () => {
  test("Mastodon's CSV: suspend rows are blocks; silence and noop are skipped as limits", () => {
    const csv = [
      '#domain,#severity,#reject_media,#reject_reports,#public_comment,#obfuscate',
      'bad.example,suspend,false,false,"spam, and lots of it",false',
      'meh.example,silence,true,false,,false',
      'fine.example,noop,false,false,,false',
      'ha*ed.example,suspend,false,false,,true',
      'Bad.Example,suspend,false,false,,false',
    ].join('\r\n');
    const p = parseBlocklist(csv);
    expect(p.domains).toEqual(['bad.example']);
    expect(p.skipped).toEqual({ limited: 2, hidden: 1, invalid: 0 });
  });

  test('a header without # and in another order', () => {
    expect(parseBlocklist('severity,domain\nsuspend,a.example\nsilence,b.example\n').domains).toEqual(['a.example']);
  });

  test("plain text and Mastodon's own export: one a line, comments and blank lines ignored", () => {
    const p = parseBlocklist('﻿# my list\n\nspam.example\n*.wild.example\nhttps://linked.example/about\n.dot.example.\nnot a server\n192.168.0.1\n');
    expect(p.domains).toEqual(['spam.example', 'wild.example', 'linked.example', 'dot.example']);
    expect(p.skipped.invalid).toBe(2);
  });

  test('JSON: names, or Mastodon API objects', () => {
    expect(parseBlocklist('["a.example", {"domain":"b.example","severity":"suspend"}, {"domain":"c.example","severity":"silence"}, 3]'))
      .toEqual({ domains: ['a.example', 'b.example'], skipped: { limited: 1, hidden: 0, invalid: 1 } });
  });

  test('international names in their ASCII form', () => {
    expect(normalizeServer('München.Example')).toBe('xn--mnchen-3ya.example');
    expect(normalizeServer('user@host.example')).toBeNull();
    expect(normalizeServer('-bad.example')).toBeNull();
  });

  test('exported as Mastodon CSV, read back the same', () => {
    const list = ['a.example', 'b.example'];
    expect(parseBlocklist(blocklistCsv(list)).domains).toEqual(list);
  });
});

describe('hiding posts', () => {
  const servers = new Set(['bad.example']);
  test('a server and everything under it', () => {
    expect(serverBlocked('bad.example', servers)).toBe(true);
    expect(serverBlocked('social.bad.example', servers)).toBe(true);
    expect(serverBlocked('notbad.example', servers)).toBe(false);
  });
  test("by its author's server, or its booster's", () => {
    expect(blockedServerOf({ handle: '@ann@bad.example' }, servers)).toBe('bad.example');
    expect(blockedServerOf({ acct: 'ann@ok.example', handle: '@ann@ok.example', booster: { acct: 'bo@bad.example' } }, servers)).toBe('bad.example');
    expect(blockedServerOf({ handle: '@ann' }, servers)).toBeNull();
    expect(blockedServerOf({ handle: '@ann@ok.example' }, new Set())).toBeNull();
  });
});

describe('where the list applies', () => {
  test('added to the moderation snapshot of origin replies and Spotlight; unreadable shows nothing', () => {
    const m = { blockedDomains: ['a.example'], domainCoverage: 'unavailable' as const };
    expect(withAtlasServers(m, ['b.example', 'a.example'])?.blockedDomains).toEqual(['a.example', 'b.example']);
    expect(withAtlasServers(m, null)).toBeNull();
    expect(withAtlasServers(null, ['b.example'])).toBeNull();
    for (const f of ['src/lib/origin-replies.functions.ts', 'src/lib/spotlight.functions.ts']) {
      expect(readFileSync(f, 'utf8')).toMatch(/withAtlasServers\(mergeVerifiedOwnerModeration\(\w+, \w+\), atlasServers\)/);
    }
  });
  test('every feed: hidden as a filter would hide it, said to be the server', () => {
    const src = readFileSync('src/components/social/useIntelligence.tsx', 'utf8');
    expect(src.match(/verdictOf\(env, /g)?.length).toBe(3);
    // Only verdictOf asks the filter engine directly.
    expect(src.match(/env\.engine\.evaluate\(/g)?.length).toBe(1);
    expect(hiddenBy('bad.example', 'server-blocked')).toBe('From bad.example, a server you block');
  });
  test('your own server is never blocked', () => {
    expect(readFileSync('src/lib/server-blocks.functions.ts', 'utf8')).toMatch(/const OWN = 'fedizen\.net'/);
  });
  test('what an import did, in a line', () => {
    expect(importSummary({ added: 120, already: 4, overLimit: 0, skipped: { limited: 2, hidden: 1, invalid: 1, own: 0 } }))
      .toBe('Added 120 servers · 4 already listed · 2 limits skipped (only blocks are imported) · 1 hidden name skipped · 1 line that isn’t a server.');
  });
});

describe('reading the whole list', () => {
  test('a page at a time past Supabase’s 1,000-row cap, in a fixed order; a failed page is no list', async () => {
    const { blockDeps, blockedServersOf, PAGE } = await import('../src/lib/server-blocks.server');
    const all = Array.from({ length: 2500 }, (_, i) => `s${i}.example`);
    const calls: [number, number][] = [];
    let failAt = -1;
    const fake = (orders: string[] = []) => ({
      order(c: string) { return fake([...orders, c]); },
      async range(from: number, to: number) {
        calls.push([from, to]);
        expect(orders).toEqual(['added_at', 'domain']);
        if (from === failAt) return { data: null, error: new Error('down') };
        return { data: all.slice(from, Math.min(to + 1, from + PAGE)).map(domain => ({ domain })), error: null };
      },
    });
    const real = blockDeps.db;
    blockDeps.db = async () => ({ from: () => ({ select: () => ({ eq: () => fake() }) }) }) as never;
    try {
      expect(await blockedServersOf('u')).toEqual(all);
      expect(calls).toEqual([[0, 999], [1000, 1999], [2000, 2999]]);
      failAt = 1000;
      expect(await blockedServersOf('u')).toBeNull();
    } finally { blockDeps.db = real; }
  });
});
