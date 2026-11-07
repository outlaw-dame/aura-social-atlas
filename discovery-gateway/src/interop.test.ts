import { describe, expect, test } from 'bun:test';
import { Service } from '@fedify/vocab';
import { assessRelayActor } from './interop.ts';

describe('read-only external relay actor preflight', () => {
  test('validates a canonical same-origin actor and inbox', async () => {
    const id = 'https://staging-relay.example/actor';
    const report = await assessRelayActor({ type: 'actor', value: id, kind: 'litepub' },
      async () => new Service({ id: new URL(id), inbox: new URL('https://staging-relay.example/inbox') }));
    expect(report).toEqual({ ok: true, requestedActor: id, canonicalActor: id, protocol: 'litepub', reason: null });
  });
  test('rejects identity and inbox substitutions without signing or persistence', async () => {
    const id = 'https://staging-relay.example/actor';
    let remote = 0;
    const lookup = async () => {
      remote++;
      return new Service({ id: new URL(id), inbox: new URL('https://attacker.example/inbox') });
    };
    const report = await assessRelayActor({ type: 'actor', value: id, kind: 'litepub' }, lookup);
    expect(report.ok).toBe(false);
    expect(report.reason).toContain('inbox');
    expect(remote).toBe(1);
  });
  test('blocks unsafe targets before lookups and reports lookup failures', async () => {
    let remote = 0;
    const lookup = async () => { remote++; return null; };
    const invalid = await assessRelayActor({ type: 'actor', value: 'https://127.0.0.1/actor', kind: 'litepub' }, lookup);
    expect(invalid.ok).toBe(false);
    expect(remote).toBe(0);
    const absent = await assessRelayActor({ type: 'actor', value: 'https://relay.example/actor', kind: 'litepub' }, lookup);
    expect(absent.ok).toBe(false);
    expect(remote).toBe(1);
  });
  test('rejects FediBuzz canonical mismatch', async () => {
    const report = await assessRelayActor({ type: 'tag', value: 'knitting' }, async () =>
      new Service({
        id: new URL('https://relay.fedi.buzz/tag/other'),
        inbox: new URL('https://relay.fedi.buzz/inbox'),
      }));
    expect(report.ok).toBe(false);
    expect(report.reason).toContain('differs');
  });
});
