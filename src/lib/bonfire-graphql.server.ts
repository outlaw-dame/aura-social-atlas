import { FEDIZEN_USER_AGENT, transportDetail } from './fedizen-http';
import { accountKey, forgetAccountReads, noteRateLimited, waitLeft } from './fedizen-rate-limit';
/**
 * Server-only Bonfire GraphQL transport.
 *
 * Fixed origin; never accepts user-supplied URLs. Query retries are bounded and
 * apply only to transient transport/HTTP failures. Mutations are NEVER
 * automatically retried: a timed-out write may already have committed.
 *
 * This transport does not establish that a GraphQL field exists on Fedizen.
 * Operation documents and response validators must be bound to a versioned
 * deployed schema before promoting a client feature.
 */
const ENDPOINT = 'https://fedizen.net/api/graphql';
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const TIMEOUT_MS = 10_000;
/** Uploads: Bonfire stores and resizes the image before it answers. */
const UPLOAD_TIMEOUT_MS = 45_000;
// 429 isn't retried here: Fedizen asked Atlas to wait (fedizen-rate-limit.ts), and asking again only extends it.
const RETRY_STATUSES = new Set([502, 503, 504]);

export type BonfireGraphQLErrorKind =
  | 'http' | 'graphql' | 'invalid-response' | 'too-large'
  | 'network' | 'cancelled';

export class BonfireGraphQLError extends Error {
  constructor(
    public readonly kind: BonfireGraphQLErrorKind,
    public readonly status?: number,
    /** For a network failure, what the runtime said (transportDetail): nothing from the request itself. */
    public readonly detail?: string,
  ) {
    super(`Bonfire GraphQL ${kind}`);
    this.name = 'BonfireGraphQLError';
  }
}

type Operation = 'query' | 'mutation';

export type BonfireGraphQLRequest<T> = {
  /** Static operation document owned by the Atlas server, not user input. */
  document: string;
  operation: Operation;
  variables?: Record<string, unknown>;
  /** Server-side delegated OAuth access token, never sent to the browser. */
  accessToken?: string;
  validate: (data: unknown) => T;
  signal?: AbortSignal;
  /** Test seam; production callers should use global fetch. */
  fetchImpl?: typeof fetch;
  /** Test seam for deterministic retry assertions. */
  waitImpl?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
  /**
   * Files for an `Upload` argument (mutations only), sent as Absinthe.Plug takes them: a multipart form with `query`,
   * `variables` (JSON) and one part per file, where the variable's value is that part's name.
   */
  files?: Record<string, { blob: Blob; name: string }>;
};

function wait(milliseconds: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(new BonfireGraphQLError('cancelled'));
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      reject(new BonfireGraphQLError('cancelled'));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, milliseconds);
    signal?.addEventListener('abort', onAbort, { once: true });
    // Close the registration race if signal aborted between the initial
    // check and attaching the listener.
    if (signal?.aborted) onAbort();
  });
}

async function readBoundedJson(response: Response): Promise<unknown> {
  const declared = response.headers.get('content-length');
  if (declared !== null && Number(declared) > MAX_RESPONSE_BYTES) {
    // A declared oversize response must be cancelled too, not just responses
    // that cross the limit while streaming.
    await response.body?.cancel().catch(() => {});
    throw new BonfireGraphQLError('too-large');
  }
  if (!response.body) throw new BonfireGraphQLError('invalid-response');
  const reader = response.body.getReader();
  let total = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_RESPONSE_BYTES) throw new BonfireGraphQLError('too-large');
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof BonfireGraphQLError) throw error;
    // A streaming failure can carry raw upstream text; normalize it before
    // crossing the service boundary.
    throw new BonfireGraphQLError('network');
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown;
  } catch {
    throw new BonfireGraphQLError('invalid-response');
  }
}

export async function requestBonfireGraphQL<T>(request: BonfireGraphQLRequest<T>): Promise<T> {
  const {
    document, operation, variables, accessToken, validate, signal,
    fetchImpl = fetch, waitImpl = wait, files,
  } = request;
  if (!document.trim() || (operation !== 'query' && operation !== 'mutation')) {
    throw new BonfireGraphQLError('invalid-response');
  }
  const fileParts = files ? Object.entries(files) : [];
  if (fileParts.length && (operation !== 'mutation' || fileParts.some(([name]) => !/^[a-z][a-z0-9_]{0,31}$/.test(name) || name === 'query' || name === 'variables'))) {
    throw new BonfireGraphQLError('invalid-response');
  }
  // Signed-out reads share one allowance; each account has its own (fedizen-rate-limit.ts).
  const account = accessToken ? await accountKey(accessToken) : 'signed-out';
  if (waitLeft(account) > 0) throw new BonfireGraphQLError('http', 429);
  // A write may change what this account read before (its own posts, likes and profile).
  if (operation === 'mutation') forgetAccountReads(account);
  const maxAttempts = operation === 'query' ? 3 : 1;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (signal?.aborted) throw new BonfireGraphQLError('cancelled');
    const pause = () => waitImpl(Math.random() * Math.min(1000, 200 * 2 ** attempt), signal);
    let response: Response;
    try {
      const headers: Record<string, string> = {
        accept: 'application/json',
        'user-agent': FEDIZEN_USER_AGENT,
      };
      let body: BodyInit;
      if (fileParts.length) {
        // The runtime sets the multipart content type and boundary.
        const form = new FormData();
        form.set('query', document);
        form.set('variables', JSON.stringify(variables ?? {}));
        for (const [name, file] of fileParts) form.set(name, file.blob, file.name);
        body = form;
      } else {
        headers['content-type'] = 'application/json';
        body = JSON.stringify({ query: document, ...(variables ? { variables } : {}) });
      }
      if (accessToken) headers.authorization = `Bearer ${accessToken}`;
      response = await fetchImpl(ENDPOINT, {
        method: 'POST',
        headers,
        body,
        signal: signal
          ? AbortSignal.any([signal, AbortSignal.timeout(fileParts.length ? UPLOAD_TIMEOUT_MS : TIMEOUT_MS)])
          : AbortSignal.timeout(fileParts.length ? UPLOAD_TIMEOUT_MS : TIMEOUT_MS),
        redirect: 'manual',
        cache: 'no-store',
      });
    } catch (e) {
      if (signal?.aborted) throw new BonfireGraphQLError('cancelled');
      if (attempt === maxAttempts - 1) throw new BonfireGraphQLError('network', undefined, transportDetail(e));
      await pause();
      continue;
    }

    if (!response.ok) {
      if (response.status === 429) {
        await response.body?.cancel().catch(() => {});
        const ms = noteRateLimited(account, response.headers.get('retry-after'));
        console.warn('Fedizen rate limited', { route: 'graphql', operation, waitSeconds: Math.round(ms / 1000) });
        throw new BonfireGraphQLError('http', 429);
      }
      if (RETRY_STATUSES.has(response.status) && attempt < maxAttempts - 1) {
        await response.body?.cancel().catch(() => {});
        await pause();
        continue;
      }
      await response.body?.cancel().catch(() => {});
      throw new BonfireGraphQLError('http', response.status);
    }

    let envelope: unknown;
    try {
      envelope = await readBoundedJson(response);
    } catch (error) {
      if (signal?.aborted) throw new BonfireGraphQLError('cancelled');
      // Safe query only: a failed stream after HTTP 200 is a transient read
      // failure. Never replay a mutation whose result may already be committed.
      if (error instanceof BonfireGraphQLError &&
        error.kind === 'network' && attempt < maxAttempts - 1) {
        await pause();
        continue;
      }
      throw error;
    }
    if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) {
      throw new BonfireGraphQLError('invalid-response');
    }
    const obj = envelope as Record<string, unknown>;
    if (obj.errors !== undefined && obj.errors !== null) {
      // Never log GraphQL errors, which can contain private data.
      // Partial data is not safe to present as a complete page.
      throw new BonfireGraphQLError('graphql');
    }
    if (!Object.hasOwn(obj, 'data')) {
      throw new BonfireGraphQLError('invalid-response');
    }
    try {
      return validate(obj.data);
    } catch {
      throw new BonfireGraphQLError('invalid-response');
    }
  }
  throw new BonfireGraphQLError('network');
}
