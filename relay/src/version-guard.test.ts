import { describe, expect, test } from 'bun:test';
import { createRelay } from '@fedify/relay';
import { MemoryKvStore } from '@fedify/fedify';
import pkg from '../package.json';
import { assertSupportedRelayVersion, VERIFIED_FEDIFY_VERSION } from './app.ts';

describe('@fedify version pin', () => {
  test('package.json pins every @fedify package exactly (no ^ or ~)', () => {
    const fedify = Object.entries(pkg.dependencies).filter(([n]) => n.startsWith('@fedify/'));
    expect(fedify.length).toBeGreaterThan(0);
    for (const [, v] of fedify) expect(v).toBe(VERIFIED_FEDIFY_VERSION);
  });
  test('installed packages match the verified version', () => expect(() => assertSupportedRelayVersion()).not.toThrow());
  test('startup refuses any other version', () => {
    expect(() => assertSupportedRelayVersion({ '@fedify/relay': '2.4.6' })).toThrow(/refusing to start/);
    expect(() => assertSupportedRelayVersion({ '@fedify/relay': '2.5.0' })).toThrow(/refusing to start/);
  });
  test('the internal deliverActivity hook still exists on both relay types', () => {
    for (const type of ['mastodon', 'litepub'] as const) {
      const relay = createRelay(type, { kv: new MemoryKvStore(), origin: 'https://relay.example.com', subscriptionHandler: async () => false });
      expect(typeof (relay as unknown as { deliverActivity?: unknown }).deliverActivity).toBe('function');
    }
  });
});
