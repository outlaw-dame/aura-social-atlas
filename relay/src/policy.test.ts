import { describe, test } from 'node:test';
import { strictEqual, throws } from 'node:assert';
import { claimedActor, isAllowedActor, parseConfig } from './policy.ts';

const base = { RELAY_PROTOCOL: 'mastodon', RELAY_ORIGIN: 'https://relay.example.com', RELAY_ALLOWED_DOMAINS: 'fedizen.net', DATABASE_URL: 'postgres://x' };

describe('relay config', () => {
  test('refuses to start as an open relay', () => throws(() => parseConfig({ ...base, RELAY_ALLOWED_DOMAINS: '' })));
  test('only mastodon or litepub', () => throws(() => parseConfig({ ...base, RELAY_PROTOCOL: 'both' })));
  test('requires durable storage outside dev', () => throws(() => parseConfig({ ...base, DATABASE_URL: '' })));
  test('requires https origin', () => throws(() => parseConfig({ ...base, RELAY_ORIGIN: 'http://relay.example.com' })));
  test('rejects private allowlist entries', () => throws(() => parseConfig({ ...base, RELAY_ALLOWED_DOMAINS: 'localhost' })));
  test('accepts a valid litepub config', () => strictEqual(parseConfig({ ...base, RELAY_PROTOCOL: 'litepub' }).protocol, 'litepub'));
});

describe('relay allowlist', () => {
  const allow = ['fedizen.net'];
  test('allows exact allowlisted https host', () => strictEqual(isAllowedActor('https://fedizen.net/pub/actors/x', allow), true));
  test('no implicit subdomains', () => strictEqual(isAllowedActor('https://evil.fedizen.net/u', allow), false));
  test('no http', () => strictEqual(isAllowedActor('http://fedizen.net/u', allow), false));
  test('no other hosts', () => strictEqual(isAllowedActor('https://spam.example/u', allow), false));
  test('reads actor from string or object', () => {
    strictEqual(claimedActor({ actor: 'https://a.b/u' }), 'https://a.b/u');
    strictEqual(claimedActor({ actor: { id: 'https://a.b/u' } }), 'https://a.b/u');
    strictEqual(claimedActor('x'), null);
  });
});
