/**
 * Embeddings with someone's own provider key, for Atlas's semantic index and semantic keyword filters — the
 * alternative to the on-device model. Same rules as llm.ts: fixed endpoints per provider, a timeout and size caps;
 * server keys on Atlas's server, device keys from the browser (not Cloudflare, which refuses browsers).
 *
 * Searches and filters are embedded as queries, posts as documents (asymmetric retrieval). Each model gets the task
 * the way its maker documents it; where none is documented, nothing is added:
 *
 * - OpenAI text-embedding-3-small, `dimensions` 256 (Matryoshka; $0.02 per 1M tokens). No task input; its guide
 *   sends plain text: developers.openai.com/api/docs/guides/embeddings
 * - Google gemini-embedding-2 (stable; 128–3072 dimensions; 8,192 tokens), through Gemini's OpenAI-compatible
 *   /embeddings, cut to 256 here. It takes no task_type: the task goes in the text, "task: search result | query: …"
 *   for queries and "title: none | text: …" for documents: ai.google.dev/gemini-api/docs/embeddings
 * - Mistral mistral-embed (1024 dimensions, kept whole). No task input documented: docs.mistral.ai/api/endpoint/embeddings
 * - Cloudflare Workers AI @cf/google/embeddinggemma-300m: the same model, prompts and cut as Atlas's on-device one,
 *   so the two share one index: developers.cloudflare.com/changelog/2026-04-09-new-workers-ai-models
 * - Voyage AI voyage-4-lite, `input_type` query/document (Voyage adds its own retrieval prompt), `output_dimension`
 *   256 ($0.02 per 1M tokens, 200M free): docs.voyageai.com/reference/embeddings-api
 * - Cohere embed-v5.0-fast, `input_type` search_query/search_document (required from v3), `output_dimension` 256,
 *   100+ languages: docs.cohere.com/reference/embed, docs.cohere.com/docs/cohere-embed
 * - Jina AI jina-embeddings-v5-text-small, `task` retrieval.query/retrieval.passage, Matryoshka (cut to 256 here):
 *   jina.ai/embeddings
 * - OpenRouter qwen/qwen3-embedding-8b (Matryoshka, cut to 256 here). Qwen3-Embedding wants a one-sentence English
 *   instruction on queries ("Instruct: …\nQuery:…"), none on documents, worth 1–5% in retrieval:
 *   huggingface.co/Qwen/Qwen3-Embedding-0.6B, openrouter.ai/docs/api/reference/embeddings
 * - Anthropic has no embedding model (it points to Voyage AI) and Moonshot's Kimi API lists none.
 *
 * Changing how a model is asked changes its vectors, so the index key names the prompt version: vectors are only
 * compared within one key.
 */
import { CLOUDFLARE_ACCOUNT, type Credential, type ProviderId } from './providers';
import { call, openAiBase, ProviderError } from './llm';
import { GEMMA_PROMPT, INDEX_DIMS, normalize, truncate, type EmbedKind } from '../semantic/vectors';
import { EMBEDDING_INDEX_KEYS as K } from '../semantic/embedding-keys';

export type EmbeddingModel = { id: string; /** Index key: vectors are only compared within one. */ key: string; matryoshka: boolean };
export const EMBEDDING_MODELS: Partial<Record<ProviderId, EmbeddingModel>> = {
  openai: { id: 'text-embedding-3-small', key: K.openai, matryoshka: true },
  google: { id: 'gemini-embedding-2', key: K.google, matryoshka: true },
  mistral: { id: 'mistral-embed', key: K.mistral, matryoshka: false },
  cloudflare: { id: '@cf/google/embeddinggemma-300m', key: K.cloudflare, matryoshka: true },
  voyage: { id: 'voyage-4-lite', key: K.voyage, matryoshka: true },
  cohere: { id: 'embed-v5.0-fast', key: K.cohere, matryoshka: true },
  jina: { id: 'jina-embeddings-v5-text-small', key: K.jina, matryoshka: true },
  openrouter: { id: 'qwen/qwen3-embedding-8b', key: K.openrouter, matryoshka: true },
};
/** The on-device model's index key: the same model as Cloudflare's, so both fill one index. */
export const LOCAL_KEY = 'embeddinggemma-300m:256';

/** Qwen3-Embedding's query instruction: one sentence, in English (how the model was trained). */
export const QWEN_QUERY_INSTRUCTION = 'Instruct: Given a search or a keyword filter, retrieve social media posts about it\nQuery:';

/** The text as each model expects it for this kind of input. */
export function asInput(provider: ProviderId, text: string, kind: EmbedKind): string {
  if (provider === 'google' || provider === 'cloudflare') return GEMMA_PROMPT[kind] + text;
  if (provider === 'openrouter' && kind === 'query') return QWEN_QUERY_INSTRUCTION + text;
  return text;
}

export const MAX_EMBED_BATCH = 32;
const MAX_CHARS = 2000;

function vectors(rows: unknown, n: number, m: EmbeddingModel): Float32Array[] {
  if (!Array.isArray(rows) || rows.length !== n) throw new ProviderError('bad-output');
  return rows.map(v => {
    if (!Array.isArray(v) || !v.length || v.length > 4096 || !v.every(x => typeof x === 'number' && Number.isFinite(x))) throw new ProviderError('bad-output');
    return m.matryoshka ? truncate(v, INDEX_DIMS) : normalize(v);
  });
}

/** Unit vectors for `texts` (a search or filter, or posts), with this key's provider. Throws bad-model for a provider
 *  without one. */
export async function embedWith(c: Credential, texts: string[], kind: EmbedKind): Promise<Float32Array[]> {
  const m = EMBEDDING_MODELS[c.provider];
  if (!m) throw new ProviderError('bad-model');
  const input = texts.slice(0, MAX_EMBED_BATCH).map(t => asInput(c.provider, t.slice(0, MAX_CHARS), kind));
  if (c.provider === 'cloudflare') {
    if (!c.account || !CLOUDFLARE_ACCOUNT.test(c.account)) throw new ProviderError('bad-key');
    const r = await call(`https://api.cloudflare.com/client/v4/accounts/${c.account}/ai/run/${m.id}`, c, {
      body: { text: input }, timeout: 30_000,
    }) as { result?: { data?: unknown } };
    return vectors(r.result?.data, input.length, m);
  }
  if (c.provider === 'cohere') {
    const r = await call(`${openAiBase(c)}/embed`, c, {
      body: { model: m.id, texts: input, input_type: kind === 'query' ? 'search_query' : 'search_document', embedding_types: ['float'], output_dimension: INDEX_DIMS, truncate: 'END' },
      timeout: 30_000,
    }) as { embeddings?: { float?: unknown } };
    return vectors(r.embeddings?.float, input.length, m);
  }
  const extra: Record<string, unknown> =
    c.provider === 'openai' ? { dimensions: INDEX_DIMS }
    : c.provider === 'voyage' ? { input_type: kind, output_dimension: INDEX_DIMS }
    : c.provider === 'jina' ? { task: kind === 'query' ? 'retrieval.query' : 'retrieval.passage', normalized: true }
    : {};
  const r = await call(`${openAiBase(c)}/embeddings`, c, { body: { model: m.id, input, ...extra }, timeout: 30_000 }) as { data?: { embedding?: unknown; index?: number }[] };
  const rows = [...(r.data ?? [])].sort((a, b) => (a.index ?? 0) - (b.index ?? 0)).map(d => d.embedding);
  return vectors(rows, input.length, m);
}
