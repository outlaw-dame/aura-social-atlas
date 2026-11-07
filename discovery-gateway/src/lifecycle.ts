/** Explicit, supervised Fedify queue worker lifecycle. */
export type GatewayRole = 'web' | 'worker' | 'combined';

export function gatewayRole(raw: string | undefined): GatewayRole {
  if (raw === undefined || raw === '') return 'combined';
  if (raw === 'web' || raw === 'worker' || raw === 'combined') return raw;
  throw new Error('GATEWAY_ROLE must be web, worker, or combined.');
}

/**
 * Fedify's startQueue stays pending while consuming jobs. A rejection or
 * unexpected resolution is fatal to the process; a supervisor must restart it.
 * The signal makes intentional shutdown a distinct, non-fatal condition.
 */
export function superviseQueue(
  start: (signal: AbortSignal) => Promise<void>,
  onUnexpectedStop: (reason: unknown) => void,
): { stop: () => Promise<void> } {
  const abort = new AbortController();
  let stopping = false;
  const task = Promise.resolve().then(() => start(abort.signal));
  void task.then(
    () => { if (!stopping) onUnexpectedStop(new Error('Federation queue worker exited unexpectedly')); },
    error => { if (!stopping) onUnexpectedStop(error); },
  );
  let stopped: Promise<void> | undefined;
  return {
    stop: () => {
      if (!stopped) {
        stopping = true;
        abort.abort();
        stopped = task;
      }
      return stopped;
    },
  };
}
