import { describe, expect, test } from 'bun:test';
import { authUiCapabilities } from '../src/lib/auth-runtime';

describe('Atlas deployment-specific authentication provider availability', () => {
  test('preserves existing Lovable login providers when not migrated', () => {
    expect(authUiCapabilities(undefined, undefined)).toEqual({
      runtime: 'lovable', google: true, lovable: true,
    });
    expect(authUiCapabilities('lovable', 'enabled')).toEqual({
      runtime: 'lovable', google: true, lovable: true,
    });
  });

  test('does not expose Lovable login on independently hosted Atlas', () => {
    expect(authUiCapabilities('supabase', undefined)).toEqual({
      runtime: 'supabase', google: false, lovable: false,
    });
    expect(authUiCapabilities('supabase', 'disabled').lovable).toBe(false);
    expect(authUiCapabilities('supabase', 'enabled')).toEqual({
      runtime: 'supabase', google: true, lovable: false,
    });
  });

  test('an unknown runtime fails closed rather than invoking Lovable SDK', () => {
    expect(authUiCapabilities('unknown', 'enabled')).toEqual({
      runtime: 'supabase', google: false, lovable: false,
    });
    expect(authUiCapabilities('', 'enabled').google).toBe(false);
  });
});
