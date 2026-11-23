import { afterEach, describe, expect, test } from 'bun:test';
import { asInput, embedWith, EMBEDDING_MODELS, QWEN_QUERY_INSTRUCTION } from '../src/lib/intelligence/embeddings';
import { EMBEDDING_INDEX_KEYS } from '../src/lib/semantic/embedding-keys';
import { embeddingPick, type RoleKey } from '../src/lib/intelligence/roles';
import type { ProviderId } from '../src/lib/intelligence/providers';

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

/** Answers like the provider would, with a 300-number vector per text, and records the request. */
function stub(shape: 'openai' | 'cohere' | 'cloudflare') {
  const seen: { url: string; body: Record<string, unknown> }[] = [];
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    seen.push({ url, body });
    const n = (body.input ?? body.texts ?? body.text).length;
    const vec = () => Array.from({ length: 300 }, (_, i) => (i + 1) / 300);
    const json = shape === 'cohere' ? { embeddings: { float: Array.from({ length: n }, vec) } }
      : shape === 'cloudflare' ? { result: { data: Array.from({ length: n }, vec) } }
      : { data: Array.from({ length: n }, (_, index) => ({ index, embedding: vec() })) };
    return new Response(JSON.stringify(json), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  return seen;
}
const cred = (provider: ProviderId) => ({ provider, key: 'not-a-real-key-0000', ...(provider === 'cloudflare' ? { account: '0'.repeat(32) } : {}) });

describe('each embedding model is asked the way its maker documents', () => {
  test('Gemini and EmbeddingGemma: the task in the text; Qwen (OpenRouter): an instruction on searches only; others: plain', () => {
    expect(asInput('google', 'cats', 'query')).toBe('task: search result | query: cats');
    expect(asInput('google', 'cats', 'document')).toBe('title: none | text: cats');
    expect(asInput('cloudflare', 'cats', 'query')).toBe('task: search result | query: cats');
    expect(asInput('openrouter', 'cats', 'query')).toBe(`${QWEN_QUERY_INSTRUCTION}cats`);
    expect(asInput('openrouter', 'cats', 'document')).toBe('cats');
    for (const p of ['openai', 'mistral', 'voyage', 'cohere', 'jina'] as const) expect(asInput(p, 'cats', 'query')).toBe('cats');
  });

  test('Voyage: input_type and 256 dimensions; Jina: retrieval task; OpenAI: dimensions; Gemini: prompts in the input', async () => {
    let seen = stub('openai');
    await embedWith(cred('voyage'), ['a'], 'query');
    expect(seen[0].url).toBe('https://api.voyageai.com/v1/embeddings');
    expect(seen[0].body).toMatchObject({ model: 'voyage-4-lite', input_type: 'query', output_dimension: 256 });
    seen = stub('openai');
    await embedWith(cred('jina'), ['a'], 'document');
    expect(seen[0].url).toBe('https://api.jina.ai/v1/embeddings');
    expect(seen[0].body).toMatchObject({ model: 'jina-embeddings-v5-text-small', task: 'retrieval.passage' });
    seen = stub('openai');
    await embedWith(cred('openai'), ['a'], 'query');
    expect(seen[0].body).toMatchObject({ dimensions: 256 });
    seen = stub('openai');
    await embedWith(cred('google'), ['a'], 'document');
    expect(seen[0].body.input).toEqual(['title: none | text: a']);
    seen = stub('openai');
    await embedWith(cred('openrouter'), ['a'], 'query');
    expect(seen[0].url).toBe('https://openrouter.ai/api/v1/embeddings');
    expect((seen[0].body.input as string[])[0].startsWith('Instruct: ')).toBe(true);
  });

  test('Cohere: its own /v2/embed with input_type, and vectors come back cut to 256 and unit length', async () => {
    const seen = stub('cohere');
    const [v] = await embedWith(cred('cohere'), ['a'], 'query');
    expect(seen[0].url).toBe('https://api.cohere.com/v2/embed');
    expect(seen[0].body).toMatchObject({ model: 'embed-v5.0-fast', input_type: 'search_query', output_dimension: 256, texts: ['a'] });
    expect(v.length).toBe(256);
    expect(Math.abs(v.reduce((s, x) => s + x * x, 0) - 1)).toBeLessThan(1e-5);
  });

  test('index keys: one per model and way of asking, shared with the semantic index', () => {
    for (const [p, m] of Object.entries(EMBEDDING_MODELS)) expect(m!.key).toBe(EMBEDDING_INDEX_KEYS[p as keyof typeof EMBEDDING_INDEX_KEYS]);
    expect(EMBEDDING_INDEX_KEYS.google).not.toBe('google:gemini-embedding-2:256');
  });
});

describe('which key does embeddings', () => {
  const k = (id: string, provider: ProviderId, models: string[] = ['m']): RoleKey => ({ id, provider, models, model: null });
  const s = { mainKey: 'main', mainModel: null, backgroundKey: null, backgroundModel: null, fallback: true };
  test('a key added for embeddings comes first, and no chat key is needed', () => {
    expect(embeddingPick(s, [k('main', 'openai'), k('v', 'voyage', [])])?.keyId).toBe('v');
    expect(embeddingPick({ ...s, mainKey: null }, [k('j', 'jina', [])])?.provider).toBe('jina');
    expect(embeddingPick(s, [k('main', 'anthropic'), k('o', 'openai')])?.keyId).toBe('o');
    expect(embeddingPick(s, [k('main', 'anthropic'), k('kimi', 'moonshot')])).toBeNull();
  });
});
