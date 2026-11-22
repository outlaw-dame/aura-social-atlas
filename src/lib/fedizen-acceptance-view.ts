/**
 * Browser-safe presentation for the staging-only Fedizen acceptance page.
 * Only an allow-listed status and allow-listed check names with a boolean
 * outcome survive; anything else the server might ever return is dropped.
 */
export type AcceptanceViewStatus = 'disabled' | 'disconnected' | 'passed' | 'failed';
export type AcceptanceViewCheck = { check: string; label: string; passed: boolean };
export type AcceptanceView = { status: AcceptanceViewStatus; checks: AcceptanceViewCheck[] };

export const ACCEPTANCE_CHECK_LABELS: Readonly<Record<string, string>> = {
  'delegated-rest-owner': 'Connected account verified (REST)',
  'graphql-me-owner': 'Same account via GraphQL',
  'graphql-own-profile': 'Own profile readable',
  'graphql-my-feed': 'Home feed readable',
  'graphql-notifications': 'Notifications readable',
  'graphql-anonymous-me-denied': 'Anonymous access refused',
};

const STATUSES: readonly AcceptanceViewStatus[] = ['disabled', 'disconnected', 'passed', 'failed'];

/** Minimum gap between deliberate diagnostic runs from one page. */
export const ACCEPTANCE_COOLDOWN_MS = 30_000;

export function sanitizeAcceptanceResult(raw: unknown): AcceptanceView {
  if (!raw || typeof raw !== 'object') return { status: 'failed', checks: [] };
  const record = raw as { status?: unknown; checks?: unknown };
  const status = STATUSES.includes(record.status as AcceptanceViewStatus)
    ? record.status as AcceptanceViewStatus : 'failed';
  const checks: AcceptanceViewCheck[] = [];
  if (Array.isArray(record.checks)) {
    for (const item of record.checks) {
      if (!item || typeof item !== 'object') continue;
      const { check, accepted } = item as { check?: unknown; accepted?: unknown };
      if (typeof check !== 'string' || !Object.hasOwn(ACCEPTANCE_CHECK_LABELS, check)) continue;
      if (checks.some(c => c.check === check)) continue;
      checks.push({ check, label: ACCEPTANCE_CHECK_LABELS[check], passed: accepted === true });
    }
  }
  // A "passed" claim needs every known check present and passing.
  if (status === 'passed' && (checks.length !== Object.keys(ACCEPTANCE_CHECK_LABELS).length || checks.some(c => !c.passed))) {
    return { status: 'failed', checks };
  }
  return { status, checks: status === 'disabled' || status === 'disconnected' ? [] : checks };
}

/** Milliseconds left before another run is allowed (0 when allowed). */
export function acceptanceCooldownRemaining(lastRunAt: number | null, now: number): number {
  if (lastRunAt === null) return 0;
  return Math.max(0, lastRunAt + ACCEPTANCE_COOLDOWN_MS - now);
}