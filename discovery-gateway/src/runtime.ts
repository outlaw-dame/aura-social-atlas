/**
 * Safety gate for Fedify 2.4.5's address-pinned outbound connections.
 *
 * Fedify validates public addresses at each hop and pins connections on Bun,
 * but Bun older than 1.4.3 can ignore proxy:false when proxy env vars exist.
 * Refuse unsupported runtimes rather than silently weakening SSRF defenses.
 */
export const MIN_SAFE_BUN = [1, 4, 3] as const;

export function assertSafeGatewayRuntime(version: string | undefined): void {
  if (!version) throw new Error('Atlas Discovery Gateway requires Bun 1.4.3 or newer.');
  const match = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(version);
  if (!match) throw new Error('Unrecognized Bun version; refusing to start gateway.');
  const actual = match.slice(1, 4).map(Number);
  for (let i = 0; i < MIN_SAFE_BUN.length; i++) {
    if (actual[i]! > MIN_SAFE_BUN[i]!) return;
    if (actual[i]! < MIN_SAFE_BUN[i]!) throw new Error('Bun 1.4.3 or newer required for SSRF-safe outbound delivery.');
  }
}
