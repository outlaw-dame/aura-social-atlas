/** Fixed, server-side identity for Fedizen requests. The header is not an authentication credential. */
export const FEDIZEN_USER_AGENT = 'Atlas/1.0 (+https://atlas-social.space; Fedizen client)';

/**
 * Classify upstream errors into a closed set. Never log an Error.message,
 * Error.cause, URL, request headers or upstream response: runtimes and
 * intermediaries can include bearer tokens, query parameters or private data.
 * This makes errors useful in different runtimes without leaking credentials.
 */
export type FedizenTransportFailure = 'dns' | 'tls' | 'timeout' | 'reset' | 'refused' | 'blocked' | 'network';

export function transportDetail(error: unknown): FedizenTransportFailure {
  if (!(error instanceof Error)) return 'network';
  const cause = (error as Error & { cause?: unknown }).cause;
  const parts = [error, ...(cause instanceof Error ? [cause] : [])];
  const codes = parts.map(part => {
    const code = (part as Error & { code?: unknown }).code;
    return typeof code === 'string' ? code.toUpperCase() : '';
  });
  // Inspect message only for classification. Never return any message substring.
  const message = parts.map(part => part.message).join(' ').toLowerCase();
  if (codes.some(code => ['ENOTFOUND', 'EAI_AGAIN', 'ERR_DNS'].includes(code)) ||
      /dns|name resolution|name not resolved|host not found/.test(message)) return 'dns';
  if (codes.some(code => ['CERT_HAS_EXPIRED', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'ERR_TLS_CERT_ALTNAME_INVALID'].includes(code)) ||
      /certificate|tls|ssl handshake/.test(message)) return 'tls';
  if (error.name === 'TimeoutError' || codes.some(code => ['ETIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT'].includes(code)) ||
      /timed out|timeout/.test(message)) return 'timeout';
  if (codes.some(code => ['ECONNRESET', 'EPIPE'].includes(code)) || /connection reset|socket hang up/.test(message)) return 'reset';
  if (codes.includes('ECONNREFUSED') || /connection refused/.test(message)) return 'refused';
  if (/blocked|forbidden|denied by policy/.test(message)) return 'blocked';
  return 'network';
}
