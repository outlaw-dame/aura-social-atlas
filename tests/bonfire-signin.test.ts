import { describe, expect, test } from 'bun:test';
import { beginBonfireSignIn } from '../src/lib/bonfire-signin';

describe('Bonfire identity sign-in initiation', () => {
  test('requests only identity scopes and the exact browser origin', async () => {
    const called: unknown[] = [];
    const failure = await beginBonfireSignIn('https://atlas-staging.damonoutlaw.xyz', async options => {
      called.push(options);
      return { error: null };
    });
    expect(failure).toBeNull();
    expect(called).toEqual([{
      provider: 'custom:app-oidc',
      options: {
        redirectTo: 'https://atlas-staging.damonoutlaw.xyz',
        scopes: 'openid profile email',
      },
    }]);
  });

  test('returns a useful configuration error rather than raw provider messages', async () => {
    const failure = await beginBonfireSignIn('https://atlas-staging.damonoutlaw.xyz', async () =>
      ({ error: { message: 'Unsupported provider custom:app-oidc' } }),
    );
    expect(failure).toMatch(/site owner needs to finish setting it up/i);
  });

  test('suppresses exception messages containing identity credentials', async () => {
    const sentinel = 'secret-authorization-code-should-not-leak';
    const failure = await beginBonfireSignIn('https://atlas-staging.damonoutlaw.xyz', async () => {
      throw new Error('failed callback https://example.test/?code=' + sentinel);
    });
    expect(failure).toMatch(/Couldn’t start Bonfire sign-in/);
    expect(failure).not.toContain(sentinel);
    expect(failure).not.toContain('https://example.test/');
  });
});
