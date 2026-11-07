import { describe, expect, test } from 'bun:test';
import { InProcessMessageQueue, MemoryKvStore } from '@fedify/fedify';
import { buildGateway } from './federation.ts';
import { loadConfig } from './config.ts';

describe('federation outbound URL admission', () => {
  test('rejects dangerous direct actor lookups before creating a remote fetch', async () => {
    let remoteCalls = 0;
    const cfg = loadConfig({
      GATEWAY_ORIGIN: 'https://gateway.example',
      DATABASE_URL: 'postgres://test:test@localhost/test',
      GATEWAY_ADMIN_TOKEN: 'abcdefghijklmnopqrstuvwxyz123456',
    });
    const gw = buildGateway(cfg, {
      kv: new MemoryKvStore(),
      queue: new InProcessMessageQueue(),
      sql: null,
    }, {
      documentLoaderFactory: () => async () => {
        remoteCalls++;
        throw new Error('untrusted outbound lookup occurred');
      },
    });
    const unsafe = [
      'http://relay.example/actor',
      'https://localhost/actor',
      'https://127.0.0.1/actor',
      'https://[::1]/actor',
      'https://relay.internal/actor',
      'https://relay.example:8443/actor',
      'https://username:password@relay.example/actor',
    ];
    for (const url of unsafe) expect(await gw.lookupActor(url)).toBeNull();
    expect(remoteCalls).toBe(0);
  });
});
