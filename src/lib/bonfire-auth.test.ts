import { describe, expect, it } from 'vitest';
import { BONFIRE_PROVIDER, BONFIRE_SCOPES, friendlyBonfireError, readOAuthError, safeNextPath } from './bonfire-auth';

describe('bonfire auth', () => {
  it('uses the prefixed custom provider id', () => {
    expect(BONFIRE_PROVIDER).toBe('custom:app-oidc');
  });
  it('requests identity scopes only', () => {
    expect(BONFIRE_SCOPES.split(' ').sort()).toEqual(['email', 'openid', 'profile']);
  });
  it('reads errors from query and hash', () => {
    expect(readOAuthError('https://a.app/?error=access_denied&error_description=No')).toEqual({ code: 'access_denied', description: 'No' });
    expect(readOAuthError('https://a.app/#error=server_error&error_description=Boom')?.code).toBe('server_error');
    expect(readOAuthError('https://a.app/?x=1')).toBeNull();
  });
  it('explains a missing provider', () => {
    expect(friendlyBonfireError('Unsupported provider: custom provider custom:app-oidc not found')).toMatch(/switched on/);
  });
  it('rejects off-site next paths', () => {
    expect(safeNextPath('//evil.com')).toBe('/');
    expect(safeNextPath('https://evil.com')).toBe('/');
    expect(safeNextPath('/saved')).toBe('/saved');
  });
});
