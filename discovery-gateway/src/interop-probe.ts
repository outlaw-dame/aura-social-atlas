/** Explicit opt-in, read-only live actor preflight. No Follow, storage or inbox. */
import { InProcessMessageQueue, MemoryKvStore } from '@fedify/fedify';
import { loadConfig } from './config.ts';
import { buildGateway } from './federation.ts';
import { assertSafeGatewayRuntime } from './runtime.ts';
import { assessRelayActor, type ProbeInput } from './interop.ts';

async function main(args: string[]): Promise<number> {
  assertSafeGatewayRuntime(process.versions.bun);
  if (args.length !== 2 || !['tag', 'instance', 'litepub'].includes(args[0]!)) {
    console.error('Usage: bun src/interop-probe.ts <tag|instance|litepub> <tag|domain|https-actor-url>');
    return 2;
  }
  const input: ProbeInput = args[0] === 'litepub'
    ? { type: 'actor', kind: 'litepub', value: args[1]! }
    : { type: args[0] as 'tag' | 'instance', value: args[1]! };

  // No actual database, gateway server, signing keys or administrator secret.
  // Synthetic origin is never contacted. Only the operator-chosen relay actor
  // is fetched through Fedify's guarded HTTPS document loader.
  const cfg = loadConfig({
    GATEWAY_ORIGIN: 'https://isolated-probe.invalid',
    DATABASE_URL: 'postgres://unused:unused@localhost/unused',
    GATEWAY_ADMIN_TOKEN: 'probe-only-no-real-admin-token-000000',
    GATEWAY_MAX_REDIRECTS: '3',
    GATEWAY_FETCH_TIMEOUT_MS: '10000',
  });
  const gateway = buildGateway(cfg, {
    kv: new MemoryKvStore(),
    queue: new InProcessMessageQueue(),
    sql: null,
  });
  const report = await assessRelayActor(input, gateway.lookupActor);
  console.log(JSON.stringify(report));
  return report.ok ? 0 : 1;
}

process.exitCode = await main(process.argv.slice(2));
