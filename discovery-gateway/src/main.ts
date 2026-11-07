/** Entrypoint: validated config → durable stores → explicitly supervised Fedify queue and HTTP. */
import { loadConfig } from './config.ts';
import { assertSafeGatewayRuntime } from './runtime.ts';
import { gatewayRole, superviseQueue } from './lifecycle.ts';
import { storesFor } from './stores.ts';
import { buildGateway, log } from './federation.ts';
import { createHandler } from './http.ts';

assertSafeGatewayRuntime(process.versions.bun);
const role = gatewayRole(process.env.GATEWAY_ROLE);
const cfg = loadConfig();
const stores = await storesFor(cfg);
const gateway = buildGateway(cfg, stores);
let server: ReturnType<typeof Bun.serve> | undefined;
let worker: ReturnType<typeof superviseQueue> | undefined;
let shutdownPromise: Promise<void> | undefined;

function shutdown(reason: string, exitCode: number): Promise<void> {
  if (shutdownPromise) return shutdownPromise;
  // Establish the idempotency barrier synchronously before asynchronous work.
  shutdownPromise = (async () => {
    log('gateway.stopping', { reason, role });
    server?.stop();
    try {
      await worker?.stop();
    } catch (error) {
      exitCode = 1;
      log('gateway.worker_shutdown_error', { type: error instanceof Error ? error.name : 'unknown' });
    }
    try {
      await stores.close();
    } catch (error) {
      exitCode = 1;
      log('gateway.store_close_error', { type: error instanceof Error ? error.name : 'unknown' });
    }
    process.exitCode = exitCode;
    log('gateway.stopped', { role, exitCode });
  })();
  return shutdownPromise;
}

try {
  if (role !== 'web') {
    worker = superviseQueue(
      signal => gateway.federation.startQueue(undefined, { signal }),
      error => {
        log('gateway.queue_failed', { type: error instanceof Error ? error.name : 'unknown' });
        void shutdown('queue_failure', 1);
      },
    );
  }
  if (role !== 'worker') {
    const handle = createHandler({ cfg, gateway, sql: stores.sql! });
    server = Bun.serve({ port: cfg.port, fetch: handle });
    log('gateway.listening', { port: server.port, role });
  } else {
    log('gateway.worker_started', { role });
  }
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => { void shutdown(signal, 0); });
  }
} catch (error) {
  await shutdown('startup_failure', 1);
  throw error;
}
