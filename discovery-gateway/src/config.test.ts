import { describe, expect, test } from 'bun:test';
import { loadConfig } from './config.ts';
const base = { GATEWAY_ORIGIN: 'https://discover.example.org', DATABASE_URL: 'postgres://test:test@localhost/gateway', GATEWAY_ADMIN_TOKEN: 'abcdef0123456789abcdef0123456789' };
describe('gateway startup config', () => {
  test('requires separate durable storage and an administrative secret', () => {
    expect(loadConfig(base).origin).toBe('https://discover.example.org');
    expect(() => loadConfig({ ...base, GATEWAY_ADMIN_TOKEN: 'short' })).toThrow();
    expect(() => loadConfig({ ...base, DATABASE_URL: '' })).toThrow();
    expect(() => loadConfig({ ...base, GATEWAY_ORIGIN: 'http://relay.example.org' })).toThrow();
  });
  test('validates CORS allowlist and integer limits', () => {
    expect(loadConfig({ ...base, GATEWAY_CORS_ORIGINS: 'https://app.example.org' }).corsAllowlist).toEqual(['https://app.example.org']);
    expect(() => loadConfig({ ...base, GATEWAY_CORS_ORIGINS: 'http://evil.example' })).toThrow();
    expect(() => loadConfig({ ...base, GATEWAY_MAX_ITEMS: '-10' })).toThrow();
  });
});
