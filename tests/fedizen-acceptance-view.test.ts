import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { classifySessionReplayError, runSessionReplay, SESSION_REPLAY_SETTLE_MS } from '../src/lib/session-revocation-check';
import { ACCEPTANCE_COOLDOWN_MS, acceptanceCooldownRemaining, sanitizeAcceptanceResult } from '../src/lib/fedizen-acceptance-view';

const allChecks = ['delegated-rest-owner', 'graphql-me-owner', 'graphql-own-profile', 'graphql-my-feed', 'graphql-notifications', 'graphql-anonymous-me-denied'];

describe('Fedizen acceptance page sanitization', () => {
  test('keeps only allow-listed status, check names and pass/fail', () => {
    const view = sanitizeAcceptanceResult({
      status: 'failed', token: 'secret-token', handle: 'alice', cursor: 'abc',
      checks: [
        { check: 'delegated-rest-owner', accepted: true, handle: 'alice', id: 'native-1' },
        { check: 'graphql-me-owner', accepted: false, error: 'raw upstream error' },
        { check: 'unknown-probe', accepted: true },
      ],
    });
    expect(view).toEqual({ status: 'failed', checks: [
      { check: 'delegated-rest-owner', label: 'Connected account verified (REST)', passed: true },
      { check: 'graphql-me-owner', label: 'Same account via GraphQL', passed: false },
    ] });
    expect(JSON.stringify(view)).not.toContain('secret-token');
    expect(JSON.stringify(view)).not.toContain('alice');
    expect(JSON.stringify(view)).not.toContain('raw upstream error');
  });
  test('unknown status or malformed payload becomes failed', () => {
    expect(sanitizeAcceptanceResult({ status: 'ok', checks: [] }).status).toBe('failed');
    expect(sanitizeAcceptanceResult(null)).toEqual({ status: 'failed', checks: [] });
  });
  test('passed requires all six checks passing', () => {
    expect(sanitizeAcceptanceResult({ status: 'passed', checks: [{ check: 'delegated-rest-owner', accepted: true }] }).status).toBe('failed');
    expect(sanitizeAcceptanceResult({ status: 'passed', checks: allChecks.map(check => ({ check, accepted: true })) }).status).toBe('passed');
  });
  test('repeated check names cannot forge an overall passing result', () => {
    const repeated = allChecks.slice(0, 5).map(check => ({ check, accepted: true }));
    repeated.push({ check: 'delegated-rest-owner', accepted: true });
    const view = sanitizeAcceptanceResult({ status: 'passed', checks: repeated });
    expect(view.status).toBe('failed');
    expect(view.checks).toHaveLength(5);
  });
  test('only a literal boolean true counts as a passing check', () => {
    for (const accepted of ['true', 1, null, [], {}]) {
      const view = sanitizeAcceptanceResult({
        status: 'passed',
        checks: allChecks.map(check => ({
          check,
          accepted: check === 'graphql-my-feed' ? accepted : true,
        })),
      });
      expect(view.status).toBe('failed');
      expect(view.checks.find(check => check.check === 'graphql-my-feed')?.passed).toBe(false);
    }
  });
  test('disabled and disconnected show no checks', () => {
    expect(sanitizeAcceptanceResult({ status: 'disabled', checks: [{ check: 'graphql-my-feed', accepted: true }] })).toEqual({ status: 'disabled', checks: [] });
    expect(sanitizeAcceptanceResult({ status: 'disconnected', checks: [] })).toEqual({ status: 'disconnected', checks: [] });
  });
  test('repeat runs wait 30 seconds', () => {
    expect(ACCEPTANCE_COOLDOWN_MS).toBe(30_000);
    expect(acceptanceCooldownRemaining(null, 1000)).toBe(0);
    expect(acceptanceCooldownRemaining(1000, 11_000)).toBe(20_000);
    expect(acceptanceCooldownRemaining(1000, 31_000)).toBe(0);
  });
});
describe('consented staging session-revocation replay', () => {
  const makeChecks = (answer: () => Promise<unknown>) =>
    Array.from({ length: 8 }, (_, i) => ({ label: 'private-read-' + i, run: answer }));

  test('only the exact session-ended refusal counts as authenticated denial', () => {
    expect(classifySessionReplayError(new Error('Unauthorized: Session has ended'))).toBe('denied');
    expect(classifySessionReplayError(new Error('Error: Unauthorized: Session has ended'))).toBe('denied');
    for (const failure of [
      new Error('Unauthorized: No authorization header provided'),
      new Error('Unauthorized: Invalid token'),
      new Error('NetworkError: Unauthorized: Session has ended'),
      new Error('fetch failed with secret-token'),
      'Unauthorized: Session has ended',
      null,
    ]) expect(classifySessionReplayError(failure)).toBe('inconclusive');
  });

  test('sign-out completes and 18 seconds elapse before 8 old-session reads', async () => {
    const order: string[] = [];
    const result = await runSessionReplay({
      signOut: async () => { order.push('signout'); },
      wait: async ms => { order.push('wait:' + ms); },
      authRefused: async () => { order.push('auth403'); return true; },
      checks: Array.from({ length: 8 }, (_, i) => ({
        label: 'private-read-' + i,
        run: async () => { order.push('read'); throw new Error('Unauthorized: Session has ended'); },
      })),
    });
    expect(SESSION_REPLAY_SETTLE_MS).toBeGreaterThan(15_000);
    expect(order.slice(0, 3)).toEqual(['signout', 'wait:' + SESSION_REPLAY_SETTLE_MS, 'auth403']);
    expect(order.slice(3)).toHaveLength(8);
    expect(result.verdict).toBe('passed');
    expect(result.authRefused).toBe(true);
    expect(result.checks.every(c => c.outcome === 'denied')).toBe(true);
  });

  test('an accepted private read is a hard failure and private output is discarded', async () => {
    const checks = makeChecks(async () => { throw new Error('Unauthorized: Session has ended'); });
    checks[4] = { label: 'private-read-4', run: async () => ({ secret: 'test-only-private-data' }) };
    const result = await runSessionReplay({ signOut: async () => {}, wait: async () => {}, authRefused: async () => true, checks });
    expect(result.verdict).toBe('failed');
    expect(result.checks[4].outcome).toBe('accepted');
    expect(JSON.stringify(result)).not.toContain('test-only-private-data');
  });

  test('network failure is inconclusive, and upstream errors cannot leak', async () => {
    const result = await runSessionReplay({
      signOut: async () => {}, wait: async () => {}, authRefused: async () => true,
      checks: makeChecks(async () => { throw new Error('fetch failed for secret-token'); }),
    });
    expect(result.verdict).toBe('inconclusive');
    expect(JSON.stringify(result)).not.toContain('secret-token');
  });

  test('an old session still accepted by Auth fails without calling private reads', async () => {
    let called = 0;
    const result = await runSessionReplay({
      signOut: async () => {}, wait: async () => {}, authRefused: async () => false,
      checks: makeChecks(async () => { called++; return null; }),
    });
    expect(result).toEqual({ verdict: 'failed', authRefused: false, checks: [] });
    expect(called).toBe(0);
  });

  test('Auth outage or missing eighth read prevents a false PASS', async () => {
    const denied = async () => { throw new Error('Unauthorized: Session has ended'); };
    const options = { signOut: async () => {}, wait: async () => {} };
    const unavailable = await runSessionReplay({ ...options, authRefused: async () => { throw new Error('outage'); }, checks: makeChecks(denied) });
    expect(unavailable.verdict).toBe('inconclusive');
    const seven = await runSessionReplay({ ...options, authRefused: async () => true, checks: makeChecks(denied).slice(0, 7) });
    expect(seven.verdict).toBe('inconclusive');
    const duplicate = makeChecks(denied); duplicate[7] = duplicate[0];
    const duplicated = await runSessionReplay({ ...options, authRefused: async () => true, checks: duplicate });
    expect(duplicated.verdict).toBe('inconclusive');
  });

  test('failed sign-out cannot produce passing replay evidence', async () => {
    await expect(runSessionReplay({
      signOut: async () => { throw new Error('logout failed'); },
      wait: async () => { throw new Error('should not wait'); },
      authRefused: async () => true, checks: makeChecks(async () => {}),
    })).rejects.toThrow('logout failed');
  });

  test('staging page keeps all eight distinct protected function calls and no bearer export', () => {
    const source = readFileSync('src/routes/fedizen-acceptance.tsx', 'utf8');
    for (const name of [
      'getFedizenStatus', 'getFedizenHome', 'getFedizenHomeLatest',
      'getFedizenMessages', 'getGroupedNotifications', 'getNotificationMarker',
      'getFedizenSaved', 'getFedizenCircles',
    ]) expect(source).toContain(name);
    expect(source).toContain('Authorization:');
    expect(source).toContain('runSessionReplay');
    expect(source).not.toContain('console.log(jwt)');
    expect(source).not.toContain('localStorage.setItem(');
  });
});
