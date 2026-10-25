import { describe, test } from 'node:test';
import { deepStrictEqual, match, strictEqual } from 'node:assert';
import { BONFIRE_PROVIDER, BONFIRE_SCOPES, friendlyBonfireError, readOAuthError, safeNextPath } from './bonfire-auth';

describe('bonfire auth', () => {
  test('uses the prefixed custom provider id', () => {
    strictEqual(BONFIRE_PROVIDER, 'custom:app-oidc');
  });
  test('requests identity scopes only', () => {
    deepStrictEqual(BONFIRE_SCOPES.split(' ').sort(), ['email', 'openid', 'profile']);
  });
  test('reads errors from query and hash', () => {
    deepStrictEqual(readOAuthError('https://a.app/?error=access_denied&error_description=No'), { code: 'access_denied', description: 'No' });
    strictEqual(readOAuthError('https://a.app/#error=server_error&error_description=Boom')?.code, 'server_error');
    strictEqual(readOAuthError('https://a.app/?x=1'), null);
  });
  test('explains a missing provider', () => {
    match(friendlyBonfireError('Unsupported provider: custom provider custom:app-oidc not found'), /switched on/);
  });
  test('rejects off-site next paths', () => {
    strictEqual(safeNextPath('//evil.com'), '/');
    strictEqual(safeNextPath('https://evil.com'), '/');
    strictEqual(safeNextPath('/saved'), '/saved');
  });
});
