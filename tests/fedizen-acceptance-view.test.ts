import { describe, expect, test } from 'bun:test';
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