/**
 * Index keys for each provider's embedding model: vectors are only compared within one key. Kept here, light, so the
 * semantic index can name the model in use without loading intelligence/embeddings.ts (which is loaded on demand).
 * A key changes whenever the model or the way it is asked changes (Gemini's task prompts, Qwen's instruction).
 */
export const EMBEDDING_INDEX_KEYS = {
  openai: 'openai:text-embedding-3-small:256',
  google: 'google:gemini-embedding-2:256:task-prompts',
  mistral: 'mistral:mistral-embed',
  cloudflare: 'embeddinggemma-300m:256',
  voyage: 'voyage:voyage-4-lite:256',
  cohere: 'cohere:embed-v5.0-fast:256',
  jina: 'jina:jina-embeddings-v5-text-small:256',
  openrouter: 'openrouter:qwen3-embedding-8b:256:instruct',
} as const;
