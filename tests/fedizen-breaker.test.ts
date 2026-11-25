import { beforeEach, describe, expect, test } from 'bun:test';
import { BREAKER, _resetBreaker, mayAskFedizen, noteFedizenAnswered, noteFedizenTimeout, noteFedizenUnreached } from '../src/lib/fedizen-breaker';

const T = 1_000_000;
beforeEach(() => _resetBreaker());

describe('when Fedizen stops answering', () => {
  test('three timeouts on different reads within 20 s pause reads for 15 s', () => {
    expect(noteFedizenTimeout('/api/v1/timelines/home', T)).toBe(false);
    expect(noteFedizenTimeout('/api/v1/notifications', T + 1000)).toBe(false);
    expect(mayAskFedizen(T + 1500)).toBe(true);
    expect(noteFedizenTimeout('/api/v1/timelines/home', T + 2000)).toBe(true);
    expect(mayAskFedizen(T + 2001)).toBe(false);
    expect(mayAskFedizen(T + 2000 + BREAKER.pauseMs - 1)).toBe(false);
  });

  test('one heavy read timing out again and again pauses nothing', () => {
    for (let i = 0; i < 6; i++) expect(noteFedizenTimeout('/api/v1/statuses/:x/context', T + i * 1000)).toBe(false);
    expect(mayAskFedizen(T + 7000)).toBe(true);
  });

  test('timeouts spread over more than 20 s pause nothing', () => {
    noteFedizenTimeout('/a', T);
    noteFedizenTimeout('/b', T + 15_000);
    expect(noteFedizenTimeout('/c', T + 25_000)).toBe(false);
    expect(mayAskFedizen(T + 25_001)).toBe(true);
  });

  test('after the pause one read probes; the rest wait until it is answered', () => {
    ['/a', '/b', '/c'].forEach((r, i) => noteFedizenTimeout(r, T + i));
    const after = T + 2 + BREAKER.pauseMs;
    expect(mayAskFedizen(after)).toBe(true);
    expect(mayAskFedizen(after + 1)).toBe(false);
    noteFedizenAnswered();
    expect(mayAskFedizen(after + 2)).toBe(true);
    expect(mayAskFedizen(after + 3)).toBe(true);
  });

  test('a probe that times out starts the pause again', () => {
    ['/a', '/b', '/c'].forEach((r, i) => noteFedizenTimeout(r, T + i));
    const after = T + 2 + BREAKER.pauseMs;
    expect(mayAskFedizen(after)).toBe(true);
    expect(noteFedizenTimeout('/a', after + 10_000)).toBe(true);
    expect(mayAskFedizen(after + 10_001)).toBe(false);
    expect(mayAskFedizen(after + 10_000 + BREAKER.pauseMs)).toBe(true);
  });

  test('a probe that fails another way lets the next read probe', () => {
    ['/a', '/b', '/c'].forEach((r, i) => noteFedizenTimeout(r, T + i));
    const after = T + 2 + BREAKER.pauseMs;
    expect(mayAskFedizen(after)).toBe(true);
    noteFedizenUnreached();
    expect(mayAskFedizen(after + 1)).toBe(true);
  });

  test('fedizenGet checks the breaker before sending and records what happened', async () => {
    const src = await Bun.file('src/lib/fedizen.server.ts').text();
    expect(src).toMatch(/if \(!mayAskFedizen\(\)\) return \{ status: 503, data: \[\], failure: 'unreachable' \}/);
    expect(src).toMatch(/noteFedizenTimeout\(readRoute\(path\)\)/);
    expect(src).toMatch(/noteFedizenAnswered\(\);/);
  });
});
