import { afterEach, describe, expect, test } from 'bun:test';
import { embedWith, EMBEDDING_MODELS, LOCAL_KEY } from '../src/lib/intelligence/embeddings';

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });
const seen: { url: string; body: Record<string, unknown> }[] = [];
const respond = (json: unknown) => {
  seen.length = 0;
  globalThis.fetch = (async (url: string, init?: RequestInit) => { seen.push({ url: String(url), body: JSON.parse(String(init?.body ?? '{}')) }); return new Response(JSON.stringify(json)); }) as unknown as typeof fetch;
};
const vec = (n: number, x = 1) => Array.from({ length: n }, (_, i) => (i === 0 ? x : 0.001));

describe('Provider embeddings for the semantic index', () => {
  test('OpenAI asks for 256 dimensions of text-embedding-3-small and keeps the order of its answer', async () => {
    respond({ data: [{ index: 1, embedding: vec(256, 2) }, { index: 0, embedding: vec(256, 1) }] });
    const out = await embedWith({ provider: 'openai', key: 'sk-test-0000000000000000' }, ['a', 'b'], 'document');
    expect(seen[0].url).toBe('https://api.openai.com/v1/embeddings');
    expect(seen[0].body).toMatchObject({ model: 'text-embedding-3-small', dimensions: 256, input: ['a', 'b'] });
    expect(out).toHaveLength(2);
    expect(out[0].length).toBe(256);
    expect(Math.hypot(...out[0])).toBeCloseTo(1);
  });
  test('Gemini is cut to 256 and normalized; Mistral keeps its 1024', async () => {
    respond({ data: [{ index: 0, embedding: vec(3072) }] });
    expect((await embedWith({ provider: 'google', key: 'AIza-test-000000000000' }, ['a'], 'query'))[0].length).toBe(256);
    expect(seen[0].url).toBe('https://generativelanguage.googleapis.com/v1beta/openai/embeddings');
    respond({ data: [{ index: 0, embedding: vec(1024) }] });
    expect((await embedWith({ provider: 'mistral', key: 'mistral-test-000000000000' }, ['a'], 'query'))[0].length).toBe(1024);
  });
  test('Cloudflare runs EmbeddingGemma with its task prompts, in the same index as the on-device model', async () => {
    respond({ result: { shape: [1, 768], data: [vec(768)] } });
    const out = await embedWith({ provider: 'cloudflare', key: 'cf-test-0000000000000000', account: 'a'.repeat(32) }, ['hello'], 'query');
    expect(seen[0].url).toBe(`https://api.cloudflare.com/client/v4/accounts/${'a'.repeat(32)}/ai/run/@cf/google/embeddinggemma-300m`);
    expect(seen[0].body).toEqual({ text: ['task: search result | query: hello'] });
    expect(out[0].length).toBe(256);
    expect(EMBEDDING_MODELS.cloudflare!.key).toBe(LOCAL_KEY);
  });
  test('a wrong count, a non-number or no embedding model is refused', async () => {
    respond({ data: [{ index: 0, embedding: vec(256) }] });
    await expect(embedWith({ provider: 'openai', key: 'sk-test-0000000000000000' }, ['a', 'b'], 'document')).rejects.toThrow('bad-output');
    respond({ data: [{ index: 0, embedding: ['x'] }] });
    await expect(embedWith({ provider: 'openai', key: 'sk-test-0000000000000000' }, ['a'], 'document')).rejects.toThrow('bad-output');
    await expect(embedWith({ provider: 'anthropic', key: 'sk-ant-test-000000000000' }, ['a'], 'document')).rejects.toThrow('bad-model');
    await expect(embedWith({ provider: 'cloudflare', key: 'cf-test-0000000000000000', account: 'nope' }, ['a'], 'document')).rejects.toThrow('bad-key');
  });
});
