import { describe, expect, test } from 'bun:test';
import { consumeOAuthState } from './fedizen.server';

type StateRow = {
  state: string;
  user_id: string;
  code_verifier: string;
  redirect_uri: string;
  created_at: string;
};

/** A small SQL DELETE...RETURNING model: filters are applied atomically
 * when maybeSingle executes. This tests the actual ownership predicate
 * supplied to the Supabase query builder without network calls. */
function stateFixture(rows: StateRow[], fail = false) {
  const db = {
    from(table: string) {
      expect(table).toBe('fedizen_oauth_states');
      let deleting = false;
      let selecting = false;
      const filters = new Map<string, string>();
      const builder = {
        delete() { deleting = true; return builder; },
        eq(key: string, value: string) { filters.set(key, value); return builder; },
        select(columns: string) { expect(columns).toBe('*'); selecting = true; return builder; },
        async maybeSingle() {
          if (fail) return { data: null, error: { code: 'DB_UNAVAILABLE' } };
          expect(deleting).toBe(true);
          expect(selecting).toBe(true);
          // A state without an authenticated-user equality predicate is a
          // cross-user deletion bug even when the state value is unguessable.
          expect(filters.has('state')).toBe(true);
          expect(filters.has('user_id')).toBe(true);
          const index = rows.findIndex(row => [...filters].every(([key, value]) =>
            row[key as keyof StateRow] === value));
          if (index < 0) return { data: null, error: null };
          const [data] = rows.splice(index, 1);
          return { data, error: null };
        },
      };
      return builder;
    },
  };
  return { db: db as unknown as Parameters<typeof consumeOAuthState>[0], rows };
}

const row = (user_id: string, state: string): StateRow => ({
  state, user_id, code_verifier: 'opaque-verifier',
  redirect_uri: 'https://atlas.example/oauth/callback',
  created_at: new Date().toISOString(),
});

describe('Fedizen OAuth state isolation / IDOR regression', () => {
  test('another authenticated account cannot delete or consume a known state', async () => {
    const fixture = stateFixture([row('alice', 'state-alice')]);
    expect(await consumeOAuthState(fixture.db, 'bob', 'state-alice')).toBeNull();
    expect(fixture.rows).toHaveLength(1);
    expect(fixture.rows[0]?.user_id).toBe('alice');
    expect((await consumeOAuthState(fixture.db, 'alice', 'state-alice'))?.state).toBe('state-alice');
    expect(fixture.rows).toHaveLength(0);
  });

  test('one-time consumption prevents callback replay', async () => {
    const fixture = stateFixture([row('alice', 'one-time')]);
    const results = await Promise.all(Array.from({ length: 12 }, () =>
      consumeOAuthState(fixture.db, 'alice', 'one-time')));
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(fixture.rows).toHaveLength(0);
    expect(await consumeOAuthState(fixture.db, 'alice', 'one-time')).toBeNull();
  });

  test('database failures fail closed instead of treating the state as valid', async () => {
    const fixture = stateFixture([row('alice', 'opaque')], true);
    await expect(consumeOAuthState(fixture.db, 'alice', 'opaque')).rejects.toThrow(
      'Could not atomically consume Fedizen authorization state.');
    expect(fixture.rows).toHaveLength(1);
  });
});
