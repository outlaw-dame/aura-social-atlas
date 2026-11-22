/**
 * Staging-only, consented sign-out check. This helper never accepts or stores a JWT:
 * the caller owns the ephemeral token in a local closure and supplies callbacks.
 * Never return private API responses or upstream error messages to the UI.
 */
export const SESSION_REPLAY_SETTLE_MS = 18_000;
export const SESSION_REPLAY_EXPECTED_READS = 8;

export type SessionReplayOutcome = 'denied' | 'accepted' | 'inconclusive';
export type SessionReplayResult = {
  verdict: 'passed' | 'failed' | 'inconclusive';
  authRefused: boolean | null;
  checks: { label: string; outcome: SessionReplayOutcome }[];
};

export type SessionReplayCheck = { label: string; run: () => Promise<unknown> };

/**
 * Only the specific live-session middleware refusal is positive evidence.
 * Network failures, generic RPC failures, or a missing bearer are inconclusive.
 */
export function classifySessionReplayError(error: unknown): 'denied' | 'inconclusive' {
  const message = error instanceof Error ? error.message : '';
  return message === 'Unauthorized: Session has ended' ||
    message === 'Error: Unauthorized: Session has ended' ? 'denied' : 'inconclusive';
}

export async function runSessionReplay({
  signOut,
  wait,
  authRefused,
  checks,
}: {
  signOut: () => Promise<void>;
  wait: (milliseconds: number) => Promise<void>;
  authRefused: () => Promise<boolean | null>;
  checks: readonly SessionReplayCheck[];
}): Promise<SessionReplayResult> {
  // Fail if sign-out does not complete; do not claim a revocation outcome.
  await signOut();
  await wait(SESSION_REPLAY_SETTLE_MS);

  // A network error is not proof that Supabase revoked the old session.
  let rejectedByAuth: boolean | null = null;
  try {
    rejectedByAuth = await authRefused();
  } catch {
    rejectedByAuth = null;
  }

  if (rejectedByAuth !== true) {
    return { verdict: rejectedByAuth === false ? 'failed' : 'inconclusive', authRefused: rejectedByAuth, checks: [] };
  }

  // A missing endpoint must not silently turn a partial run into an eight-read PASS.
  if (checks.length !== SESSION_REPLAY_EXPECTED_READS ||
    new Set(checks.map(check => check.label)).size !== SESSION_REPLAY_EXPECTED_READS) {
    return { verdict: 'inconclusive', authRefused: true, checks: [] };
  }

  const results = await Promise.all(checks.map(async check => {
    try {
      await check.run();
      // A resolved server function has crossed the private-route authorization boundary.
      // Do not retain or display its possibly private response.
      return { label: check.label, outcome: 'accepted' as const };
    } catch (error) {
      return { label: check.label, outcome: classifySessionReplayError(error) };
    }
  }));

  const verdict = results.some(result => result.outcome === 'accepted')
    ? 'failed' : results.every(result => result.outcome === 'denied') ? 'passed' : 'inconclusive';
  return { verdict, authRefused: true, checks: results };
}
