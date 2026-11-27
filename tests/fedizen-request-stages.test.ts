import { afterEach, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { _resetFedizenRequestStages, _stagesInternals, fedizenRequestStages } from '../src/lib/fedizen-request-stages.server';

afterEach(() => _resetFedizenRequestStages());

describe('where pending Fedizen requests are when reads pause', () => {
  test('by stage, with the oldest wait in each; stale entries let go', () => {
    const now = 1_000_000;
    _stagesInternals.requests.set({}, { at: now - 12_000, sent: false, answered: false });
    _stagesInternals.requests.set({}, { at: now - 3_000, sent: false, answered: false });
    _stagesInternals.requests.set({}, { at: now - 11_000, sent: true, answered: false });
    _stagesInternals.requests.set({}, { at: now - 6 * 60_000, sent: true, answered: false });
    const s = fedizenRequestStages(now);
    expect(s.pending).toEqual({ 'waiting for a connection': { count: 2, oldestMs: 12_000 }, 'sent, waiting for an answer': { count: 1, oldestMs: 11_000 } });
    expect(_stagesInternals.requests.size).toBe(3);
    expect(s).toMatchObject({ connecting: 0, connectErrors: 0, secondsSinceLastConnect: null });
  });
  test('logged with each pause, never with paths or headers', () => {
    const src = readFileSync('src/lib/fedizen.server.ts', 'utf8');
    expect(src).toMatch(/console\.warn\('Fedizen not answering: reads paused', \{ seconds: BREAKER\.pauseMs \/ 1000, stages: fedizenRequestStages\(\) \}\)/);
    const mod = readFileSync('src/lib/fedizen-request-stages.server.ts', 'utf8');
    expect(mod).not.toMatch(/\.path\b|headers\)/);
  });
});
