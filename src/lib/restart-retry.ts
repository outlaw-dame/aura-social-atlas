/**
 * Riding out a server restart (browser side).
 *
 * Atlas's staging server is reached through Cloudflare Tunnel, and cloudflared doesn't wait for a server that is
 * starting: while it boots (a deploy, a crash restart) the tunnel answers 502 at once. Seen on 25 Nov 2026 in
 * cloudflared's log: "Unable to reach the origin service … connect: connection refused", the visitor got a 502.
 * Railway's own edge answers 503/504 in the same moment. Booting takes about 0.4 s on the slim image (3–11 s before).
 *
 * So reads (GET and HEAD only) that meet one of those answers, or a failed connection, are asked again after 1 s and
 * then 2 s. Writes are never repeated: a 502 can also come after the server received the request, and a like or a
 * reply must not be sent twice. A request the page cancelled isn't retried, and a cancel during the wait stops it.
 */

/** What a proxy in front of Atlas answers while Atlas's server isn't taking connections. */
export const RESTARTING_STATUSES: ReadonlySet<number> = new Set([502, 503, 504]);

/** Waits before each retry; two retries at most. */
export const RETRY_DELAYS_MS: readonly number[] = [1_000, 2_000];

type Fetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

function methodOf(input: RequestInfo | URL, init?: RequestInit): string {
  if (init?.method) return init.method.toUpperCase();
  if (typeof Request !== 'undefined' && input instanceof Request) return input.method.toUpperCase();
  return 'GET';
}

function signalOf(input: RequestInfo | URL, init?: RequestInit): AbortSignal | undefined {
  if (init?.signal) return init.signal;
  if (typeof Request !== 'undefined' && input instanceof Request) return input.signal;
  return undefined;
}

function wait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const timer = setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve(); }, ms);
    function onAbort() { clearTimeout(timer); reject(signal!.reason); }
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/** `fetchImpl`, but reads ride out a restart: see the top of this file. */
export function retryWhileRestarting(
  fetchImpl: Fetch,
  delays: readonly number[] = RETRY_DELAYS_MS,
  sleep: (ms: number, signal?: AbortSignal) => Promise<void> = wait,
): Fetch {
  return async (input, init) => {
    const method = methodOf(input, init);
    if (method !== 'GET' && method !== 'HEAD') return fetchImpl(input, init);
    const signal = signalOf(input, init);
    for (let attempt = 0; ; attempt++) {
      const last = attempt >= delays.length;
      try {
        const response = await fetchImpl(input, init);
        if (last || !RESTARTING_STATUSES.has(response.status)) return response;
        // Not used: free the connection before asking again.
        await response.body?.cancel().catch(() => undefined);
      } catch (error) {
        if (last || signal?.aborted) throw error;
      }
      await sleep(delays[attempt], signal);
    }
  };
}
