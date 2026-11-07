import { describe, expect, test } from 'bun:test';
import { InProcessMessageQueue, MemoryKvStore } from '@fedify/fedify';
import { buildGateway } from './federation.ts';
import { loadConfig } from './config.ts';

describe('gateway actor WebFinger interoperability', () => {
  const origin = 'https://gateway.example';
  const cfg = loadConfig({
    GATEWAY_ORIGIN: origin,
    DATABASE_URL: 'postgres://unused:unused@localhost/unused',
    GATEWAY_ADMIN_TOKEN: 'webfinger-test-only-secret-not-used-outside-ci',
  });

  function gateway() {
    return buildGateway(cfg, {
      kv: new MemoryKvStore(),
      queue: new InProcessMessageQueue(),
      sql: null,
    });
  }

  test('advertised fediverse handle resolves to canonical fixed-path actor', async () => {
    const gw = gateway();
    const webfinger = new URL('/.well-known/webfinger', origin);
    webfinger.searchParams.set('resource', 'acct:atlas-discovery-gateway@gateway.example');
    const response = await gw.fetch(new Request(webfinger));
    expect(response.status).toBe(200);
    const body = await response.json() as {
      subject?: string;
      links?: { rel: string; type?: string; href?: string }[];
    };
    expect(body.subject).toBe('acct:atlas-discovery-gateway@gateway.example');
    expect(body.links?.some(link =>
      link.rel === 'self' && link.type === 'application/activity+json' &&
      link.href === origin + '/actor')).toBe(true);
    expect(body.links?.some(link => link.href?.includes('/actors/gateway'))).toBe(false);
  });

  test('the internal identifier is not an alternate public WebFinger handle', async () => {
    const gw = gateway();
    const webfinger = new URL('/.well-known/webfinger', origin);
    webfinger.searchParams.set('resource', 'acct:gateway@gateway.example');
    const response = await gw.fetch(new Request(webfinger));
    expect(response.status).toBe(404);
  });
});
