import { describe, expect, test } from 'bun:test';
import { BonfireGraphQLError } from '../src/lib/bonfire-graphql.server';
import { fedizenAcceptanceEnabled, probeAtlasFedizenConnection } from '../src/lib/bonfire-acceptance.server';

const identity = { user: { id: 'native-alice', character: { username: 'alice' }, profile: null } };
const page = { nodes: [], pageInfo: { endCursor: null, startCursor: null, hasNextPage: false, hasPreviousPage: false } };
function deps(overrides: Record<string, unknown> = {}) {
  return {
    tokenFor: async (subject: string) => subject === 'alice' ? {
      access_token: 'opaque-token', account_handle: 'alice',
    } : null,
    verifyGrant: async () => 'alice',
    readMe: async (token: string) => token ? identity : null,
    readProfile: async () => ({ id: 'native-alice', character: { username: 'alice' } }),
    readPage: async () => page,
    ...overrides,
  } as unknown as NonNullable<Parameters<typeof probeAtlasFedizenConnection>[1]>;
}

describe('Atlas-scoped live acceptance diagnostic', () => {
  test('defaults off and only enables exact staging value', () => {
    expect(fedizenAcceptanceEnabled(undefined)).toBe(false);
    expect(fedizenAcceptanceEnabled('true')).toBe(false);
    expect(fedizenAcceptanceEnabled('verified')).toBe(false);
    expect(fedizenAcceptanceEnabled('enabled')).toBe(true);
  });
  test('reads only the independently authenticated Atlas subject', async () => {
    const selected: string[] = [];
    const base = deps();
    const mock = deps({
      tokenFor: async (subject: string) => {
        selected.push(subject);
        return base.tokenFor(subject);
      },
    });
    const result = await probeAtlasFedizenConnection('alice', mock);
    expect(result.status).toBe('passed');
    expect(result.checks).toHaveLength(6);
    expect(result.checks.every(x => x.accepted)).toBe(true);
    expect(selected).toEqual(['alice']);
    expect(JSON.stringify(result)).not.toContain('opaque-token');
    expect(JSON.stringify(result)).not.toContain('native-alice');
  });
  test('disconnected account triggers no remote requests', async () => {
    const result = await probeAtlasFedizenConnection('bob', deps({
      verifyGrant: () => { throw Error('should never run'); },
    }));
    expect(result).toEqual({ status: 'disconnected', checks: [] });
  });
  test('REST/GraphQL identity mismatch fails before private reads', async () => {
    let reads = 0;
    const result = await probeAtlasFedizenConnection('alice', deps({
      readMe: async () => ({ user: { id: 'native-bob', character: { username: 'bob' } } }),
      readPage: async () => { reads++; return page; },
    }));
    expect(result.status).toBe('failed');
    expect(reads).toBe(0);
    expect(result.checks.at(-1)).toEqual({ check: 'graphql-me-owner', accepted: false });
  });
  test('missing or wrong delegated grant fails closed', async () => {
    for (const rest of [null, 'mallory@fedizen.net']) {
      const result = await probeAtlasFedizenConnection('alice', deps({ verifyGrant: async () => rest }));
      expect(result.status).toBe('failed');
      expect(result.checks).toEqual([{ check: 'delegated-rest-owner', accepted: false }]);
    }
  });
  test('native missing cursor is not a passing page', async () => {
    const result = await probeAtlasFedizenConnection('alice', deps({
      readPage: async () => ({ nodes: [], pageInfo: { ...page.pageInfo, hasNextPage: true } }),
    }));
    expect(result.status).toBe('failed');
    expect(result.checks.at(-1)?.check).toBe('graphql-my-feed');
  });
  test('upstream errors never disclose details', async () => {
    const result = await probeAtlasFedizenConnection('alice', deps({
      readMe: async () => { throw Error('private body/token/credential'); },
    }));
    expect(result.status).toBe('failed');
    expect(JSON.stringify(result)).not.toMatch(/private|body|credential|token/);
  });
  test('transient anonymous error is not evidence of privacy', async () => {
    const result = await probeAtlasFedizenConnection('alice', deps({
      readMe: async (token: string) => {
        if (!token) throw new BonfireGraphQLError('network');
        return identity;
      },
    }));
    expect(result.status).toBe('failed');
    expect(result.checks.at(-1)).toEqual({ check: 'graphql-anonymous-me-denied', accepted: false });
  });
  test('explicit anonymous HTTP denial is acceptable', async () => {
    const result = await probeAtlasFedizenConnection('alice', deps({
      readMe: async (token: string) => {
        if (!token) throw new BonfireGraphQLError('http', 403);
        return identity;
      },
    }));
    expect(result.status).toBe('passed');
  });
});
