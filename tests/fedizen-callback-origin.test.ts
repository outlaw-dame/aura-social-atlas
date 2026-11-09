import { describe, expect, test } from 'bun:test';
import { allowedCallback, FEDIZEN_API_SCOPE } from '../src/lib/fedizen-feed';

describe('Fedizen OAuth redirect-origin trust boundary', () => {
  test('delegated authorization remains read-only', () => {
    expect(FEDIZEN_API_SCOPE).toBe('read');
  });

  test('accepts only the exact browser request origin on the current Atlas host', () => {
    expect(allowedCallback('https://atlas.lovable.app', 'https://atlas.lovable.app'))
      .toBe('https://atlas.lovable.app/fedizen/callback');
    expect(allowedCallback('https://atlas.lovableproject.com', 'https://atlas.lovableproject.com'))
      .toBe('https://atlas.lovableproject.com/fedizen/callback');
    expect(allowedCallback('http://localhost:3000', 'http://localhost:3000'))
      .toBe('http://localhost:3000/fedizen/callback');
  });

  test.each([
    ['https://attacker.lovable.app', 'https://atlas.lovable.app'],
    ['https://atlas.lovable.app', 'https://attacker.lovable.app'],
    ['https://atlas.lovable.app', null],
    ['https://atlas.lovable.app', 'null'],
    ['https://atlas.lovable.app', 'http://atlas.lovable.app'],
    ['https://atlas.lovable.app', 'https://atlas.lovable.app.evil.example'],
    ['http://atlas.lovable.app', 'http://atlas.lovable.app'],
    ['https://evil.example', 'https://evil.example'],
    ['https://lovable.app', 'https://lovable.app'],
    ['https://lovableproject.com', 'https://lovableproject.com'],
    ['https://atlas.lovable.app:8443', 'https://atlas.lovable.app'],
    ['https://atlas.lovable.app/path', 'https://atlas.lovable.app'],
    ['https://atlas.lovable.app?return=https://evil.example', 'https://atlas.lovable.app'],
    ['https://atlas.lovable.app/#fragment', 'https://atlas.lovable.app'],
    ['https://user:pass@atlas.lovable.app', 'https://atlas.lovable.app'],
    ['https://atlas.lovable.app/', 'https://atlas.lovable.app'],
    ['https://atlas.lovable.app', 'https://atlas.lovable.app/'],
    ['http://localhost:3000', 'http://localhost:3001'],
    ['http://127.0.0.1:3000', 'http://127.0.0.1:3000'],
  ] as const)('refuses untrusted, noncanonical or cross-origin redirect %#', (client, request) => {
    expect(allowedCallback(client, request)).toBeNull();
  });

  test('a configured deployment list is exact, denies other tenants and supports a custom HTTPS domain', () => {
    const config = 'https://atlas.example.org, https://atlas.lovable.app';
    expect(allowedCallback('https://atlas.example.org', 'https://atlas.example.org', config))
      .toBe('https://atlas.example.org/fedizen/callback');
    expect(allowedCallback('https://atlas.lovable.app', 'https://atlas.lovable.app', config))
      .toBe('https://atlas.lovable.app/fedizen/callback');
    expect(allowedCallback('https://other.lovable.app', 'https://other.lovable.app', config))
      .toBeNull();
    expect(allowedCallback('http://atlas.example.org', 'http://atlas.example.org', config))
      .toBeNull();
    expect(allowedCallback('https://atlas.example.org.evil.example', 'https://atlas.example.org.evil.example', config))
      .toBeNull();
  });

  test('a misconfigured allowlist fails closed instead of allowing any Lovable tenant', () => {
    expect(allowedCallback('https://atlas.lovable.app', 'https://atlas.lovable.app',
      'https://atlas.lovable.app/path')).toBeNull();
    expect(allowedCallback('https://atlas.lovable.app', 'https://atlas.lovable.app',
      'http://atlas.lovable.app')).toBeNull();
    expect(allowedCallback('https://atlas.lovable.app', 'https://atlas.lovable.app',
      'https://other.lovable.app')).toBeNull();
  });
});
