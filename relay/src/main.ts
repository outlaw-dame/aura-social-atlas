import { buildRelay, log, storesFor } from './app.ts';
import { parseConfig } from './policy.ts';

let cfg;
try { cfg = parseConfig(process.env); } catch (e) { console.error((e as Error).message); process.exit(1); }
const stores = await storesFor(cfg);
const { relay, handle } = buildRelay(cfg, stores);

const server = Bun.serve({
  port: cfg.port,
  maxRequestBodySize: cfg.maxBodyBytes,
  fetch: async (req) => {
    try { return await handle(req); }
    catch { log('request.error'); return new Response('Internal error', { status: 500 }); }
  },
});
log('relay.started', {
  protocol: cfg.protocol, port: cfg.port, allowedDomains: cfg.allowedDomains.length,
  // Give this to the Fedizen admin; it comes from the library, not hard-coded paths.
  subscribeWith: cfg.protocol === 'mastodon' ? (await relay.getSharedInboxUri()).href : (await relay.getActorUri()).href,
});

async function shutdown(signal: string) {
  log('relay.stopping', { signal });
  await server.stop();
  await stores.close();
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
