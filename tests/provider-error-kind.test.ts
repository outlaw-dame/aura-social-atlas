import { describe, expect, test } from 'bun:test';
import { errorKind } from '../src/lib/intelligence/llm';

describe('errorKind: what a provider error was, without its message', () => {
  test("Google's OpenAI layer wraps the error in an array", () => {
    expect(errorKind('[{"error":{"code":400,"message":"Invalid JSON payload: echoed text","status":"INVALID_ARGUMENT"}}]'))
      .toEqual({ code: '400', type: undefined, status: 'INVALID_ARGUMENT' });
  });
  test('OpenAI-shaped errors give code and type', () => {
    expect(errorKind('{"error":{"message":"secret prompt here","type":"invalid_request_error","code":"model_not_found"}}'))
      .toEqual({ code: 'model_not_found', type: 'invalid_request_error', status: undefined });
  });
  test('never returns free text, and ignores bodies that are not JSON errors', () => {
    expect(errorKind('{"error":{"type":"has spaces and a prompt","message":"hello"}}')).toBeUndefined();
    expect(errorKind('<html>502 Bad Gateway</html>')).toBeUndefined();
    expect(errorKind('{"ok":true}')).toBeUndefined();
  });
});
