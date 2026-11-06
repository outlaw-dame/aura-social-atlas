import { describe, expect, test } from 'bun:test';
import { checkRemoteUrl, fediBuzzActorUrl } from './urlguard.ts';
import { resolveSubscriptionTarget } from './subscribe.ts';

describe('source URL validation', () => {
  test('rejects private, localhost and ambiguous targets', () => {
    for (const url of ['http://relay.example/actor', 'https://127.0.0.1/inbox', 'https://[::1]/inbox', 'https://localhost/inbox', 'https://relay.internal/actor', 'https://user:pass@relay.example/a', 'https://relay.example:8443/a', 'https://0x7f000001/a']) {
      expect(checkRemoteUrl(url).ok).toBe(false);
    }
  });
  test('constructs selective URLs with validated segments', () => {
    const tag = fediBuzzActorUrl('tag', '#Knitting');
    const instance = fediBuzzActorUrl('instance', 'Fluffy.Family');
    expect(tag.ok).toBe(true);
    expect(instance.ok).toBe(true);
    if (tag.ok) expect(tag.url.href).toBe('https://relay.fedi.buzz/tag/knitting');
    if (instance.ok) expect(instance.url.href).toBe('https://relay.fedi.buzz/instance/fluffy.family');
    expect(fediBuzzActorUrl('tag', '../admin').ok).toBe(false);
    expect(fediBuzzActorUrl('instance', 'localhost').ok).toBe(false);
  });
  test('separates FediBuzz actor-follow from Mastodon and LitePub', () => {
    expect(resolveSubscriptionTarget({ type: 'tag', value: 'fedi' })).toMatchObject({ ok: true, kind: 'fedibuzz-tag' });
    expect(resolveSubscriptionTarget({ type: 'actor', value: 'https://relay.example/inbox', kind: 'mastodon' })).toMatchObject({ ok: true, kind: 'mastodon' });
  });
});
