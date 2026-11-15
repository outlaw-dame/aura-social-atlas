import { describe, expect, mock, test } from 'bun:test';
import { verifiedNativeBonfireConnection } from '../src/lib/bonfire-verified-connection.server';
import type { tokenFor } from '../src/lib/fedizen.server';
import type { readNativeBonfireMe } from '../src/lib/bonfire-private.server';

const A = 'af405a8b-a00c-45b2-b611-de84b387159f';
const B = 'cfb302b5-bb98-4334-818b-ea4c84821fe2';
const credentials = {
  [A]: { access_token: 'opaque-a', account_handle: 'alice@fedizen.net' },
  [B]: { access_token: 'opaque-b', account_handle: 'bob@fedizen.net' },
};
function fixture(options: {
  wrongNativeOwner?: boolean;
  missing?: boolean;
  throwDb?: boolean;
  malformedIdentity?: boolean;
} = {}) {
  const db = mock(async (id: string) => {
    if (options.throwDb) throw Error('private credential backend error');
    if (options.missing) return null;
    return credentials[id as keyof typeof credentials] ?? null;
  });
  const me = mock(async (token: string) => {
    const username = options.wrongNativeOwner ? 'attacker' : token === 'opaque-a' ? 'alice' : 'bob';
    return options.malformedIdentity ? null : {
      accountId: 'opaque-account',
      user: {
        id: token === 'opaque-a' ? 'bonfire-a' : 'bonfire-b',
        character: { username, canonicalUri: null },
        profile: { name: username, icon: null },
      },
    };
  });
  return {
    dependencies: {
      tokenFor: db as unknown as typeof tokenFor,
      readMe: me as unknown as typeof readNativeBonfireMe,
    },
    db, me,
  };
}

describe('Atlas-to-Fedizen actual verified connection authorization boundary', () => {
  test('mismatched caller intent fails before any DB or private GraphQL request', async () => {
    const f = fixture();
    await expect(verifiedNativeBonfireConnection(A, B, f.dependencies))
      .rejects.toThrow('Atlas session changed');
    expect(f.db).not.toHaveBeenCalled();
    expect(f.me).not.toHaveBeenCalled();
  });

  test('authenticated Supabase subject selects its own per-user token and identity', async () => {
    const f = fixture();
    const a = await verifiedNativeBonfireConnection(A, A, f.dependencies);
    const b = await verifiedNativeBonfireConnection(B, B, f.dependencies);
    expect(a).toMatchObject({ status: 'available', accessToken: 'opaque-a', accountHandle: 'alice@fedizen.net' });
    expect(b).toMatchObject({ status: 'available', accessToken: 'opaque-b', accountHandle: 'bob@fedizen.net' });
    expect(f.db.mock.calls.map(args => args[0])).toEqual([A, B]);
    expect(f.me.mock.calls.map(args => args[0])).toEqual(['opaque-a', 'opaque-b']);
  });

  test('concurrent users cannot cross-join connection tokens during reads', async () => {
    const f = fixture();
    const results = await Promise.all([
      verifiedNativeBonfireConnection(B, B, f.dependencies),
      verifiedNativeBonfireConnection(A, A, f.dependencies),
      verifiedNativeBonfireConnection(B, B, f.dependencies),
      verifiedNativeBonfireConnection(A, A, f.dependencies),
    ]);
    expect(results.map(r => r.status)).toEqual(['available', 'available', 'available', 'available']);
    expect(results.map(r => r.status === 'available' ? r.accessToken : null))
      .toEqual(['opaque-b', 'opaque-a', 'opaque-b', 'opaque-a']);
  });

  test('missing connection cannot trigger a remote identity read', async () => {
    const f = fixture({ missing: true });
    expect(await verifiedNativeBonfireConnection(A, A, f.dependencies))
      .toEqual({ status: 'disconnected' });
    expect(f.me).not.toHaveBeenCalled();
  });

  test('a stored token for the wrong native identity is denied', async () => {
    const f = fixture({ wrongNativeOwner: true });
    expect(await verifiedNativeBonfireConnection(A, A, f.dependencies))
      .toEqual({ status: 'identity-unverified' });
    expect(f.me).toHaveBeenCalledTimes(1);
  });

  test('missing native Me identity cannot authorize reads', async () => {
    const f = fixture({ malformedIdentity: true });
    expect(await verifiedNativeBonfireConnection(A, A, f.dependencies))
      .toEqual({ status: 'authorization-required' });
  });

  test('database errors fail closed and do not trigger remote calls', async () => {
    const f = fixture({ throwDb: true });
    await expect(verifiedNativeBonfireConnection(A, A, f.dependencies))
      .rejects.toThrow('private credential backend error');
    expect(f.me).not.toHaveBeenCalled();
  });

  test('the server-boundary error never includes A/B IDs or secrets', async () => {
    const f = fixture();
    let errorText = '';
    try {
      await verifiedNativeBonfireConnection(A, B, f.dependencies);
    } catch (error) {
      errorText = String(error);
    }
    expect(errorText).toContain('Atlas session changed');
    for (const secret of [A, B, 'opaque-a', 'opaque-b']) {
      expect(errorText).not.toContain(secret);
    }
  });
});
