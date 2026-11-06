/** Entrypoint: config → stores → federation → HTTP. Fails closed on any misconfiguration. */
import { loadConfig } from './config.ts';
import { storesFor } from './stores.ts';
import { buildGateway, log } from './federation.ts';
import { createHandler } from './http.ts';

const cfg = loadConfig();
const stores = await storesFor(cfg);
const gateway = buildGateway(cfg, stores);
const handle = createHandler({ cfg, gateway, sql: stores.sql! });

const server = Bun.serve({ port: cfg.port, fetch: handle });
log('gateway.listening', { port: server.port });

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, async () => {
    log('gateway.stopping', {});
    server.stop();
    await stores.close();
    process.exit(0);
  });
}
