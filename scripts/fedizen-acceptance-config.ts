/**
 * Safe diagnostic for protected GitHub acceptance: output only missing
 * configuration KEY NAMES, never secret values, identity or upstream data.
 * Presence is not proof of validity or read-only scope; live probes decide.
 */
export function missingFedizenTestKeys(
  env: Record<string, string | undefined>,
  keys: readonly string[],
): string[] {
  return keys.filter(key => !env[key]?.trim());
}

export function requireFedizenTestKeys(
  env: Record<string, string | undefined>,
  keys: readonly string[],
): void {
  const missing = missingFedizenTestKeys(env, keys);
  if (missing.length) {
    throw new Error(
      `Missing protected GitHub environment secrets: ${missing.join(', ')}. ` +
      'A Fedizen account password or an OIDC sign-in is not an API bearer grant. ' +
      'No token values were inspected or printed.',
    );
  }
}
