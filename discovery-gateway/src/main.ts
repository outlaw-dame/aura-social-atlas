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
let adminServer: ReturnType<typeof Bun.serve> | undefined;
let worker: ReturnType<typeof superviseQueue> | undefined;
let shutdownPromise: Promise<void> | undefined;

function shutdown(reason: string, exitCode: number): Promise<void> {
  if (shutdownPromise) return shutdownPromise;
  // Establish the idempotency barrier synchronously before asynchronous work.
  shutdownPromise = (async () => {
    log('gateway.stopping', { reason, role });
    server?.stop();
    adminServer?.stop();
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
    // The only publicly routed Railway listener rejects /admin even if a
    // request bypasses Cloudflare. Never expose GATEWAY_ADMIN_PORT as a
    // Railway public target port or domain.
    const handle = createHandler({ cfg, gateway, sql: stores.sql! });
    server = Bun.serve({ port: cfg.port, fetch: handle });
    // This separate port is reachable through Railway private networking.
    // The handler still requires the administrator bearer token.
    const privateAdmin = createHandler({
      cfg, gateway, sql: stores.sql!, adminEnabled: true,
    });
    adminServer = Bun.serve({
      port: cfg.adminPort,
      fetch: request => {
        const path = new URL(request.url).pathname;
        if (path !== '/admin' && !path.startsWith('/admin/')) {
          return new Response('Not found', { status: 404 });
        }
        return privateAdmin(request);
      },
    });
    log('gateway.listening', { port: server.port, role });
    log('gateway.private_admin_listening', { port: adminServer.port, role });
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
