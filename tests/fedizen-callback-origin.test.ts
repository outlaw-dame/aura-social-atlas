import { describe, expect, test } from 'bun:test';
import { allowedCallback, FEDIZEN_API_SCOPE } from '../src/lib/fedizen-feed';

describe('Fedizen OAuth redirect-origin trust boundary', () => {
  test('asks Fedizen to read and to act for the person (join groups, follow)', () => {
    expect(FEDIZEN_API_SCOPE).toBe('read write follow');
  });

  test('accepts only the exact browser request origin on the current Atlas host', () => {
    for (const o of ['https://aura-social-atlas.lovable.app', 'https://preview--aura-social-atlas.lovable.app',
      'https://id-preview--d3fdefe8-1c72-40dc-8fa6-0b966befbe5b.lovable.app', 'https://id-preview-b5bac2df--d3fdefe8-1c72-40dc-8fa6-0b966befbe5b.lovable.app',
      'https://d3fdefe8-1c72-40dc-8fa6-0b966befbe5b.lovableproject.com', 'https://atlas-social.space', 'https://www.atlas-social.space',
      'https://project--d3fdefe8-1c72-40dc-8fa6-0b966befbe5b.lovable.app', 'https://project--d3fdefe8-1c72-40dc-8fa6-0b966befbe5b-dev.lovable.app'])
      expect(allowedCallback(o, o)).toBe(`${o}/fedizen/callback`);
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
    // Other Lovable tenants, with no allowlist configured
    ['https://atlas.lovable.app', 'https://atlas.lovable.app'],
    ['https://atlas.lovableproject.com', 'https://atlas.lovableproject.com'],
    ['https://id-preview--00000000-1c72-40dc-8fa6-0b966befbe5b.lovable.app', 'https://id-preview--00000000-1c72-40dc-8fa6-0b966befbe5b.lovable.app'],
    ['https://preview--aura-social-atlas-evil.lovable.app', 'https://preview--aura-social-atlas-evil.lovable.app'],
    ['https://evil--d3fdefe8-1c72-40dc-8fa6-0b966befbe5b.lovable.app', 'https://evil--d3fdefe8-1c72-40dc-8fa6-0b966befbe5b.lovable.app'],
    ['https://aura-social-atlas.lovable.app.evil.example', 'https://aura-social-atlas.lovable.app.evil.example'],
    ['http://atlas-social.space', 'http://atlas-social.space'],
    ['https://project--00000000-1c72-40dc-8fa6-0b966befbe5b.lovable.app', 'https://project--00000000-1c72-40dc-8fa6-0b966befbe5b.lovable.app'],
    ['https://project--d3fdefe8-1c72-40dc-8fa6-0b966befbe5b-evil.lovable.app', 'https://project--d3fdefe8-1c72-40dc-8fa6-0b966befbe5b-evil.lovable.app'],
    ['https://evil.atlas-social.space', 'https://evil.atlas-social.space'],
    ['https://atlas-social.space.evil.example', 'https://atlas-social.space.evil.example'],
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
