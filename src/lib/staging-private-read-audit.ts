/**
 * Staging-only audit of owner-authenticated Atlas private server functions.
 * It never stores or returns their private payloads, only endpoint outcomes
 * and the visibility classes observed in the first Home page.
 */
export type PrivateReadCheck = { label: string; run: () => Promise<unknown> };
export type PrivateReadEvidence = {
  outcome: 'complete' | 'incomplete';
  checks: { label: string; result: 'readable' | 'inconclusive' }[];
  homeSampleCount: number | null;
  nonPublicHomeCount: number | null;
};

const EXPECTED_READS = 8;

export async function auditPrivateReads(checks: readonly PrivateReadCheck[]): Promise<PrivateReadEvidence> {
  if (checks.length !== EXPECTED_READS || new Set(checks.map(c => c.label)).size !== EXPECTED_READS) {
    return { outcome: 'incomplete', checks: [], homeSampleCount: null, nonPublicHomeCount: null };
  }
  let homeSampleCount: number | null = null;
  let nonPublicHomeCount: number | null = null;
  const results = await Promise.all(checks.map(async ({ label, run }) => {
    try {
      const result = await run();
      if (!result || typeof result !== 'object' || Array.isArray(result)) {
        return { label, result: 'inconclusive' as const };
      }
      const record = result as Record<string, unknown>;
      if (record.connected === false || (typeof record.error === 'string' && record.error)) {
        return { label, result: 'inconclusive' as const };
      }
      if (label === 'Fedizen connection') {
        if (record.connected !== true) return { label, result: 'inconclusive' as const };
      }
      if (label === 'Following / Home') {
        if (record.connected !== true || !Array.isArray(record.posts)) {
          return { label, result: 'inconclusive' as const };
        }
        const posts = record.posts as unknown[];
        homeSampleCount = posts.length;
        nonPublicHomeCount = posts.filter(p => p && typeof p === 'object' &&
          ['private', 'direct'].includes((p as { visibility?: string }).visibility ?? '')).length;
      }
      return { label, result: 'readable' as const };
    } catch {
      // Unexpected refusals include network/middleware failures. Neither is
      // proof of a Bonfire authorization result; never log the raw error.
      return { label, result: 'inconclusive' as const };
    }
  }));
  return {
    outcome: results.every(c => c.result === 'readable') ? 'complete' : 'incomplete',
    checks: results,
    homeSampleCount,
    nonPublicHomeCount,
  };
}
