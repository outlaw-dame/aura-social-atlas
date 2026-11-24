import { afterEach, describe, expect, test } from 'bun:test';
import { ProviderError, call } from '../src/lib/intelligence/llm';

// A provider's answer by status, with fetch stubbed (an invented key; nothing is sent).
const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });
const status = (s: number) => { globalThis.fetch = (async () => new Response('{"error":{"message":"x"}}', { status: s })) as unknown as typeof fetch; };
const codeOf = async () => { try { await call('https://openrouter.ai/api/v1/embeddings', { provider: 'openrouter', key: 'sk-or-v1-invented-key-for-tests' }, { body: {} }); return 'ok'; } catch (e) { return e instanceof ProviderError ? e.code : 'other'; } };

describe('what a provider said, as the person is told it', () => {
  test('401 is a key the provider rejects or has turned off; 402 is no credit left (OpenRouter); 403 no access', async () => {
    status(401); expect(await codeOf()).toBe('bad-key');
    status(402); expect(await codeOf()).toBe('no-credit');
    status(403); expect(await codeOf()).toBe('no-access');
    status(503); expect(await codeOf()).toBe('unavailable');
  });
});

describe('a model that refuses chat requests', () => {
  test("Gemini's Live-only model answers 400 to both tries: choose another model, not try again", async () => {
    const { completeJson } = await import('../src/lib/intelligence/llm');
    let calls = 0;
    globalThis.fetch = (async () => { calls++; return new Response('[{"error":{"code":400,"status":"INVALID_ARGUMENT"}}]', { status: 400 }); }) as unknown as typeof fetch;
    const task = { system: 's', input: {}, schemaName: 'x', schema: { type: 'object' } };
    const code = await completeJson({ provider: 'google', key: 'invented-key' }, 'gemini-3.8-live', task).then(() => 'ok', e => (e instanceof ProviderError ? e.code : 'other'));
    expect(code).toBe('bad-model');
    expect(calls).toBe(2);
  });
});
