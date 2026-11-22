import { describe, expect, test } from 'bun:test';
import { runAccountAuth } from '../src/lib/account-auth';

describe('Atlas email/password authentication recovery', () => {
  test('passes through a successful sign-in session', async () => {
    const session = { access_token: 'not-real' };
    const result = await runAccountAuth(async () => ({
      data: { session },
      error: null,
    }));
    expect(result).toEqual({ kind: 'success', data: { session } });
  });

  test('preserves normal Supabase form errors', async () => {
    const result = await runAccountAuth(async () => ({
      data: { session: null },
      error: { message: 'Invalid login credentials' },
    }));
    expect(result).toEqual({ kind: 'error', message: 'Invalid login credentials' });
  });

  test('recovers from rejected network requests without exposing exception details', async () => {
    const sensitive = 'secret-access-token-must-stay-private';
    const result = await runAccountAuth(async (): Promise<never> => {
      throw new Error('Fetch failed: https://example.test/callback?access_token=' + sensitive);
    });
    expect(result.kind).toBe('error');
    if (result.kind === 'error') {
      expect(result.message).toContain('Please try again');
      expect(result.message).not.toContain(sensitive);
      expect(result.message).not.toContain('https://');
    }
  });
});
