import { describe, expect, test } from 'bun:test';
import { assertSafeGatewayRuntime } from './runtime.ts';

describe('outbound transport startup guard', () => {
  test('requires Bun with proxy-safe pinned outbound support', () => {
    for (const value of [undefined, '', '1.3.4', '1.4.0', '1.4.2', '0.99.0', '1.4', 'not-a-version']) {
      expect(() => assertSafeGatewayRuntime(value)).toThrow();
    }
    for (const value of ['1.4.3', '1.4.4', '1.5.0', '2.0.0', '1.4.3+build']) {
      expect(() => assertSafeGatewayRuntime(value)).not.toThrow();
    }
  });
});
