/**
 * Embeddings with someone's own provider key, for Atlas's semantic index — the alternative to the on-device model.
 * Same rules as llm.ts: fixed endpoints per provider, a timeout and size caps; server keys on Atlas's server, device
 * keys from the browser (not Cloudflare, which refuses browsers).
 *
 * Which model per provider (checked November 2026):
 * - OpenAI text-embedding-3-small, /v1/embeddings, `dimensions` 256 (Matryoshka; $0.02 per 1M tokens):
 *   developers.openai.com/api/docs/models/text-embedding-3-small
 * - Google gemini-embedding-2 (stable; 128–3072 dimensions; 8,192 tokens), through Gemini's OpenAI-compatible
 *   /embeddings, cut to 256 here: ai.google.dev/gemini-api/docs/models/gemini-embedding-2
 * - Mistral mistral-embed, /v1/embeddings (1024 dimensions, not truncatable, kept whole): docs.mistral.ai/api/endpoint/embeddings
 * - Cloudflare Workers AI @cf/google/embeddinggemma-300m (768 dimensions, 512 tokens), /ai/run: the same model as
 *   Atlas's on-device one, with the same prompts and cut, so the two share one index:
 *   developers.cloudflare.com/changelog/2026-04-09-new-workers-ai-models
 * - Anthropic has no embedding model (it points to Voyage AI: platform.claude.com/docs/en/build-with-claude/embeddings),
 *   and Moonshot's Kimi API lists none; with those keys the on-device model is the option.
 */
import { CLOUDFLARE_ACCOUNT, type Credential, type ProviderId } from './providers';
import { call, openAiBase, ProviderError } from './llm';
import { GEMMA_PROMPT, INDEX_DIMS, normalize, truncate, type EmbedKind } from '../semantic/vectors';

export type EmbeddingModel = { id: string; /** Index key: vectors are only compared within one. */ key: string; matryoshka: boolean };
export const EMBEDDING_MODELS: Partial<Record<ProviderId, EmbeddingModel>> = {
  openai: { id: 'text-embedding-3-small', key: 'openai:text-embedding-3-small:256', matryoshka: true },
  google: { id: 'gemini-embedding-2', key: 'google:gemini-embedding-2:256', matryoshka: true },
  mistral: { id: 'mistral-embed', key: 'mistral:mistral-embed', matryoshka: false },
  cloudflare: { id: '@cf/google/embeddinggemma-300m', key: 'embeddinggemma-300m:256', matryoshka: true },
};
/** The on-device model's index key: the same model as Cloudflare's, so both fill one index. */
export const LOCAL_KEY = 'embeddinggemma-300m:256';

export const MAX_EMBED_BATCH = 32;
const MAX_CHARS = 2000;

function vectors(rows: unknown, n: number, m: EmbeddingModel): Float32Array[] {
  if (!Array.isArray(rows) || rows.length !== n) throw new ProviderError('bad-output');
  return rows.map(v => {
    if (!Array.isArray(v) || !v.length || v.length > 4096 || !v.every(x => typeof x === 'number' && Number.isFinite(x))) throw new ProviderError('bad-output');
    return m.matryoshka ? truncate(v, INDEX_DIMS) : normalize(v);
  });
}

/** Unit vectors for `texts` (a search, or posts), with this key's provider. Throws bad-model for a provider without one. */
export async function embedWith(c: Credential, texts: string[], kind: EmbedKind): Promise<Float32Array[]> {
  const m = EMBEDDING_MODELS[c.provider];
  if (!m) throw new ProviderError('bad-model');
  const input = texts.slice(0, MAX_EMBED_BATCH).map(t => t.slice(0, MAX_CHARS));
  if (c.provider === 'cloudflare') {
    if (!c.account || !CLOUDFLARE_ACCOUNT.test(c.account)) throw new ProviderError('bad-key');
    const r = await call(`https://api.cloudflare.com/client/v4/accounts/${c.account}/ai/run/${m.id}`, c, {
      body: { text: input.map(t => GEMMA_PROMPT[kind] + t) }, timeout: 30_000,
    }) as { result?: { data?: unknown } };
    return vectors(r.result?.data, input.length, m);
  }
  const r = await call(`${openAiBase(c)}/embeddings`, c, {
    body: { model: m.id, input, ...(c.provider === 'openai' ? { dimensions: INDEX_DIMS } : {}) }, timeout: 30_000,
  }) as { data?: { embedding?: unknown; index?: number }[] };
  const rows = [...(r.data ?? [])].sort((a, b) => (a.index ?? 0) - (b.index ?? 0)).map(d => d.embedding);
  return vectors(rows, input.length, m);
}
