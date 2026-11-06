import { describe, expect, test } from 'bun:test';
import { RateLimiter, tokenMatches } from './http.ts';

describe('admin authentication and request throttling', () => {
  const token = 'abcdef0123456789abcdef0123456789';
  test('accepts only exact bearer tokens', () => {
    expect(tokenMatches(token, token)).toBe(true);
    expect(tokenMatches(token.slice(1), token)).toBe(false);
    expect(tokenMatches(token + 'suffix', token)).toBe(false);
    expect(tokenMatches(null, token)).toBe(false);
    expect(tokenMatches('', token)).toBe(false);
  });
  test('rate limiter closes the bucket after the configured count', () => {
    const limiter = new RateLimiter(2);
    expect(limiter.allow('anonymous')).toBe(true);
    expect(limiter.allow('anonymous')).toBe(true);
    expect(limiter.allow('anonymous')).toBe(false);
    expect(limiter.allow('different')).toBe(true);
  });
});
