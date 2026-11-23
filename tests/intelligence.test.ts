import { afterEach, describe, expect, test } from 'bun:test';
import { openRow, sealCredential, VaultError } from '../src/lib/intelligence/vault.server';
import { completeJson, listModels, openAiBase, parseJsonReply, ProviderError } from '../src/lib/intelligence/llm';
import { chatModels, defaultModel, keyHint, PROVIDER_IDS } from '../src/lib/intelligence/providers';

const SECRET = 'test-secret-with-at-least-thirty-two-characters!!';
const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; delete process.env.ATLAS_AI_KEY_SECRET; delete process.env.ATLAS_AI_KEY_SECRET_PREVIOUS; });

describe('key vault', () => {
  test('round-trips a key; the ciphertext holds no plaintext', async () => {
    process.env.ATLAS_AI_KEY_SECRET = SECRET;
    const sealed = await sealCredential('u1', { provider: 'openai', key: 'sk-test-1234567890abcdef' });
    expect(sealed.ciphertext).not.toContain('sk-test');
    expect(atob(sealed.ciphertext)).not.toContain('sk-test');
    const { credential } = await openRow('u1', { provider: 'openai', ...sealed });
    expect(credential.key).toBe('sk-test-1234567890abcdef');
  });
  test('a row moved to another person or provider does not decrypt', async () => {
    process.env.ATLAS_AI_KEY_SECRET = SECRET;
    const sealed = await sealCredential('u1', { provider: 'openai', key: 'sk-test-1234567890abcdef' });
    await expect(openRow('u2', { provider: 'openai', ...sealed })).rejects.toBeInstanceOf(VaultError);
    await expect(openRow('u1', { provider: 'mistral', ...sealed })).rejects.toBeInstanceOf(VaultError);
  });
  test('fresh IV each time', async () => {
    process.env.ATLAS_AI_KEY_SECRET = SECRET;
    const a = await sealCredential('u1', { provider: 'openai', key: 'sk-test-1234567890abcdef' });
    const b = await sealCredential('u1', { provider: 'openai', key: 'sk-test-1234567890abcdef' });
    expect(a.iv).not.toBe(b.iv);
    expect(a.ciphertext).not.toBe(b.ciphertext);
  });
  test('rotation: rows from the previous secret still open, and are flagged for re-encryption', async () => {
    process.env.ATLAS_AI_KEY_SECRET = SECRET;
    const old = await sealCredential('u1', { provider: 'cloudflare', key: 'cf-token-1234567890', account: '0123456789abcdef0123456789abcdef' });
    process.env.ATLAS_AI_KEY_SECRET = `${SECRET}-new-one`;
    process.env.ATLAS_AI_KEY_SECRET_PREVIOUS = SECRET;
    const { credential, stale } = await openRow('u1', { provider: 'cloudflare', ...old });
    expect(credential.account).toBe('0123456789abcdef0123456789abcdef');
    expect(stale).toBe(true);
  });
  test('no secret, or a short one: not configured', async () => {
    await expect(sealCredential('u1', { provider: 'openai', key: 'sk-test-1234567890abcdef' })).rejects.toMatchObject({ code: 'not-configured' });
    process.env.ATLAS_AI_KEY_SECRET = 'short';
    await expect(sealCredential('u1', { provider: 'openai', key: 'sk-test-1234567890abcdef' })).rejects.toMatchObject({ code: 'not-configured' });
  });
});

describe('provider calls', () => {
  const seen: { url: string; headers: Record<string, string>; body?: Record<string, unknown> }[] = [];
  const fake = (reply: unknown, status = 200) => {
    seen.length = 0;
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      seen.push({ url, headers: init.headers as Record<string, string>, body: init.body ? JSON.parse(String(init.body)) : undefined });
      return new Response(JSON.stringify(reply), { status });
    }) as typeof fetch;
  };
  test('each key only goes to its own provider', () => {
    const hosts = PROVIDER_IDS.map(p => new URL(openAiBase({ provider: p, key: 'k', account: '0123456789abcdef0123456789abcdef' })).host);
    expect(hosts).toEqual(['api.anthropic.com', 'api.openai.com', 'generativelanguage.googleapis.com', 'api.mistral.ai', 'api.moonshot.ai', 'api.cloudflare.com', 'api.voyageai.com', 'api.cohere.com', 'api.jina.ai', 'openrouter.ai']);
    expect(() => openAiBase({ provider: 'cloudflare', key: 'k', account: '../../evil' })).toThrow(ProviderError);
  });
  test('Anthropic: native Messages API with x-api-key and a JSON schema', async () => {
    fake({ content: [{ type: 'text', text: '{"wordings":["a"]}' }] });
    const r = await completeJson({ provider: 'anthropic', key: 'sk-ant-x' }, 'claude-haiku-5-5', { system: 's', input: {}, schemaName: 'n', schema: { type: 'object' } });
    expect(r).toEqual({ wordings: ['a'] });
    expect(seen[0].url).toBe('https://api.anthropic.com/v1/messages');
    expect(seen[0].headers['x-api-key']).toBe('sk-ant-x');
    expect(seen[0].body?.output_config).toEqual({ format: { type: 'json_schema', schema: { type: 'object' } } });
    expect(seen[0].body).not.toHaveProperty('temperature');
  });
  test('OpenAI: bearer key, max_completion_tokens, strict schema', async () => {
    fake({ choices: [{ message: { content: '{"ok":true}' } }] });
    await completeJson({ provider: 'openai', key: 'sk-x' }, 'gpt-5.6-terra', { system: 's', input: {}, schemaName: 'n', schema: {} });
    expect(seen[0].headers.authorization).toBe('Bearer sk-x');
    expect(seen[0].body).toHaveProperty('max_completion_tokens');
    expect((seen[0].body?.response_format as { json_schema: { strict: boolean } }).json_schema.strict).toBe(true);
  });
  test('errors map to codes, and provider error text is never passed on', async () => {
    fake({ error: { message: 'Incorrect API key provided: sk-x' } }, 401);
    const e = await listModels({ provider: 'openai', key: 'sk-x' }).catch(x => x);
    expect(e).toBeInstanceOf(ProviderError);
    expect(e.code).toBe('bad-key');
    expect(String(e.message)).not.toContain('sk-x');
  });
  test('Gemini model names lose their models/ prefix', async () => {
    fake({ data: [{ id: 'models/gemini-3.8-flash' }, { id: 'models/gemini-embedding-001' }] });
    expect(await listModels({ provider: 'google', key: 'AIza-x' })).toEqual(['gemini-3.8-flash', 'gemini-embedding-001']);
  });
  test('tolerant JSON parsing', () => {
    expect(parseJsonReply('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(parseJsonReply('Here you go: {"a":1} hope that helps')).toEqual({ a: 1 });
    expect(() => parseJsonReply('nope')).toThrow(ProviderError);
  });
});

describe('models', () => {
  test('a small fast model first; embeddings and image models left out', () => {
    expect(defaultModel('anthropic', ['claude-opus-5-5', 'claude-haiku-5-5', 'claude-sonnet-5-5'])).toBe('claude-haiku-5-5');
    expect(chatModels('openai', ['gpt-5.6', 'text-embedding-3-small', 'gpt-5.6-terra', 'dall-e-3'])).toEqual(['gpt-5.6-terra', 'gpt-5.6']);
    expect(defaultModel('google', ['gemini-3.8-pro', 'gemini-3.8-flash', 'gemini-3.8-flash-image'])).toBe('gemini-3.8-flash');
    expect(keyHint('sk-abcdefgh1234')).toBe('…1234');
  });

  test("Google's image, world, robotics, Live-only, aqa, computer-use and Antigravity models are left out", () => {
    // Ids as Gemini listed them for a key on staging, 23 Nov 2026.
    const listed = ['gemini-3.8-flash', 'nano-banana-pro-preview', 'genie-4', 'gemma-4-31b-it', 'gemini-robotics-er-2-preview', 'gemini-pro-latest',
      'gemini-nano-banana-2.1', 'gemini-flash-latest', 'gemini-3.8-live-extended-thinking', 'gemini-3.8-live', 'gemini-3.5-live-translate-preview',
      'gemini-3.1-flash-live-preview', 'gemini-2.5-computer-use-preview-10-2025', 'aqa', 'antigravity-preview-latest', 'gemini-2.5-flash'];
    expect(chatModels('google', listed)).toEqual(['gemini-3.8-flash', 'gemma-4-31b-it', 'gemini-pro-latest', 'gemini-flash-latest', 'gemini-2.5-flash']);
  });
});

describe('browser calls (keys kept on the device)', () => {
  test('Anthropic gets its direct-browser header only in a browser; Cloudflare is refused there', async () => {
    const g = globalThis as unknown as { window?: unknown; document?: unknown };
    g.window = {}; g.document = {};
    try {
      const seen: Record<string, string>[] = [];
      globalThis.fetch = (async (_u: string, init: RequestInit) => { seen.push(init.headers as Record<string, string>); return new Response(JSON.stringify({ data: [{ id: 'claude-haiku-5-5' }] })); }) as typeof fetch;
      await listModels({ provider: 'anthropic', key: 'sk-ant-x' });
      expect(seen[0]['anthropic-dangerous-direct-browser-access']).toBe('true');
      const e = await listModels({ provider: 'cloudflare', key: 'k', account: '0123456789abcdef0123456789abcdef' }).catch(x => x);
      expect(e.code).toBe('browser-blocked');
      globalThis.fetch = (async () => { throw new TypeError('Failed to fetch'); }) as unknown as typeof fetch;
      expect((await listModels({ provider: 'mistral', key: 'k' }).catch(x => x)).code).toBe('browser-blocked');
    } finally { delete g.window; delete g.document; }
  });
  test('on the server, no browser header', async () => {
    const seen: Record<string, string>[] = [];
    globalThis.fetch = (async (_u: string, init: RequestInit) => { seen.push(init.headers as Record<string, string>); return new Response(JSON.stringify({ data: [] })); }) as typeof fetch;
    await listModels({ provider: 'anthropic', key: 'sk-ant-x' });
    expect(seen[0]['anthropic-dangerous-direct-browser-access']).toBeUndefined();
  });
});
