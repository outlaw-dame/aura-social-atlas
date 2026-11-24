import { describe, expect, test } from 'bun:test';
import {
  canonicalBlockedDomain, parseOwnerNativeModeration, readOwnerNativeModeration,
  mergeVerifiedOwnerModeration, VIEWER_MODERATION_DOCUMENT,
} from '../src/lib/spotlight-native-moderation.server';
import { allowedSpotlightItem, type SpotlightModeration } from '../src/lib/spotlight-curation';
import type { SpotlightItem } from '../src/lib/spotlight';

const rest: SpotlightModeration = {
  blockedHandles: ['blocked@fedizen.net'], mutedHandles: [], blockedIds: ['blocked-id'], mutedIds: [],
  domainCoverage: 'unavailable', blockedDomains: [],
};
const native = {
  revision: 'rev:owner-1',
  complete: true,
  blockedDomains: ['blocked.example'],
  rejectKeywords: [],
  warnKeywords: [],
};
const data = (policy: unknown = native, username = 'alice') => ({
  me: { user: { character: { username } } },
  viewerModeration: policy,
});
const item = (handle: string, host: string): SpotlightItem => ({
  id: `a:${handle}`, url: `https://${host}/story`, title: 'Public story', description: '',
  provider: host, source: 'Bonfire', kind: 'article', reason: 'recent',
  sourceAccounts: [{ handle, actorUrl: `https://${host}/users/1` }],
  sourceComplete: true,
});

describe('Bonfire owner-native moderation negotiation', () => {
  test('never accepts an unbound or partial owner policy', () => {
    expect(VIEWER_MODERATION_DOCUMENT).not.toContain('userId');
    expect(parseOwnerNativeModeration(data(), 'alice@fedizen.net')?.revision).toBe('rev:owner-1');
    expect(parseOwnerNativeModeration(data(native, 'bob'), 'alice@fedizen.net')).toBeNull();
    expect(parseOwnerNativeModeration(data(native, 'alice@remote.example'), 'alice@fedizen.net')).toBeNull();
    expect(parseOwnerNativeModeration({ me: null, viewerModeration: native }, 'alice')).toBeNull();
    expect(parseOwnerNativeModeration(data({ ...native, complete: false }), 'alice')).toBeNull();
    expect(parseOwnerNativeModeration(data({ ...native, blockedDomains: null }), 'alice')).toBeNull();
    expect(parseOwnerNativeModeration(data({ ...native, blockedDomains: undefined }), 'alice')).toBeNull();
    expect(parseOwnerNativeModeration(data({ ...native, rejectKeywords: undefined }), 'alice')).toBeNull();
    expect(parseOwnerNativeModeration(data({ ...native, revision: null }), 'alice')).toBeNull();
    expect(parseOwnerNativeModeration(data({ ...native, blockedDomains: ['ok.example', 'bad host'] }), 'alice')).toBeNull();
    expect(parseOwnerNativeModeration({ ...data(), extraPrivateData: 'not-requested' }, 'alice')).toBeNull();
  });

  test('validates IDN, domain boundaries, oversized and unsafe hostnames', () => {
    expect(canonicalBlockedDomain('BÜCHER.example')).toBe('xn--bcher-kva.example');
    expect(canonicalBlockedDomain('xn--bcher-kva.example')).toBe('xn--bcher-kva.example');
    for (const host of ['*.example.org', 'https://example.org', 'user@example.org', 'example.org:8443',
      'example.org/path', '.example.org', 'example.org.', 'a..example.org', '127.0.0.1',
      'localhost', 'bad_name.example.org', 'example.org ', '']) {
      expect(canonicalBlockedDomain(host)).toBeNull();
    }
    expect(parseOwnerNativeModeration(data({ ...native, blockedDomains: Array.from({ length: 10_001 }, () => 'example.org') }), 'alice')).toBeNull();
    expect(parseOwnerNativeModeration(data({ ...native, warnKeywords: [''] }), 'alice')).toBeNull();
    expect(parseOwnerNativeModeration(data({ ...native, rejectKeywords: Array.from({ length: 201 }, () => 'spam') }), 'alice')).toBeNull();
    const parsed = parseOwnerNativeModeration(data({
      ...native, blockedDomains: ['EXAMPLE.ORG', 'example.org', 'BÜCHER.example'],
    }), 'alice');
    expect(parsed?.blockedDomains).toEqual(['example.org', 'xn--bcher-kva.example']);
  });

  test('does not allow remote recommendations without the strict REST account lists', () => {
    const policy = parseOwnerNativeModeration(data(), 'alice');
    expect(mergeVerifiedOwnerModeration(null, policy)).toBeNull();
    const verified = mergeVerifiedOwnerModeration(rest, policy);
    expect(verified?.domainCoverage).toBe('complete');
    expect(verified?.blockedHandles).toEqual(rest.blockedHandles);
    expect(allowedSpotlightItem(item('remote@allowed.example', 'allowed.example'), verified!)).toBe(true);
    expect(allowedSpotlightItem(item('remote@blocked.example', 'blocked.example'), verified!)).toBe(false);
    expect(allowedSpotlightItem(item('remote@sub.blocked.example', 'sub.blocked.example'), verified!)).toBe(false);
    expect(allowedSpotlightItem(item('blocked@fedizen.net', 'fedizen.net'), verified!)).toBe(false);
    expect(allowedSpotlightItem(item('remote@blocked.example.evil', 'blocked.example.evil'), verified!)).toBe(true);
  });

  test('unknown/partial provider policy or ANY native keyword keeps remote actors withheld', () => {
    expect(mergeVerifiedOwnerModeration(rest, null)).toBe(rest);
    const reject = parseOwnerNativeModeration(data({ ...native, rejectKeywords: ['spam'] }), 'alice');
    const warn = parseOwnerNativeModeration(data({ ...native, warnKeywords: ['spoilers'] }), 'alice');
    expect(mergeVerifiedOwnerModeration(rest, reject)?.domainCoverage).toBe('unavailable');
    expect(mergeVerifiedOwnerModeration(rest, warn)?.domainCoverage).toBe('unavailable');
    expect(allowedSpotlightItem(item('remote@allowed.example', 'allowed.example'), mergeVerifiedOwnerModeration(rest, warn)!)).toBe(false);
  });

  test('does not call Fedizen at all while the rollout capability is disabled', async () => {
    let hits = 0;
    const fetchImpl = (async () => { hits++; throw new Error('should not run'); }) as typeof fetch;
    expect(await readOwnerNativeModeration('token', 'alice', { fetchImpl }, false)).toBeNull();
    expect(hits).toBe(0);
  });

  test('reads fixed GraphQL endpoint using only the owner bearer; validates owner before return', async () => {
    const calls: { url: string; auth: string | null; method: string; query: string }[] = [];
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({
        url: String(url), auth: new Headers(init?.headers).get('authorization'),
        method: init?.method ?? '', query: JSON.parse(String(init?.body)).query,
      });
      return new Response(JSON.stringify({ data: data() }), { status: 200 });
    }) as typeof fetch;
    const result = await readOwnerNativeModeration('secret-owner-test', 'alice@fedizen.net', { fetchImpl }, true);
    expect(result?.blockedDomains).toEqual(['blocked.example']);
    expect(calls).toEqual([{
      url: 'https://fedizen.net/api/graphql', auth: 'Bearer secret-owner-test',
      method: 'POST', query: VIEWER_MODERATION_DOCUMENT,
    }]);
  });

  test('rejects unauthorized, partial GraphQL and mismatched-owner results', async () => {
    const run = (body: unknown, status = 200) => readOwnerNativeModeration(
      'secret-owner-test', 'alice', {
        fetchImpl: (async () => new Response(JSON.stringify(body), { status })) as typeof fetch,
      }, true,
    );
    expect(await run({ data: data(native, 'bob') })).toBeNull();
    expect(await run({ data: data(), errors: [{ message: 'secret error' }] })).toBeNull();
    expect(await run({ data: data({ ...native, complete: false }) })).toBeNull();
    expect(await run({ errors: [{ message: 'no such field' }] })).toBeNull();
    expect(await run({}, 403)).toBeNull();
  });
});
