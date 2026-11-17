/**
 * Vector arithmetic for Atlas's semantic index. Pure and browser-safe.
 *
 * Every vector is stored unit-length, so cosine similarity is a dot product. Models trained with Matryoshka
 * Representation Learning (EmbeddingGemma, OpenAI text-embedding-3, Gemini embeddings) keep their meaning in the leading
 * dimensions: a vector cut to its first 256 numbers and normalized again is still a good embedding, at a third of the
 * storage (EmbeddingGemma model card: 768 → 512, 256 or 128 by truncating and re-normalizing).
 */

/** Dimensions kept for models that allow truncation. */
export const INDEX_DIMS = 256;

export function normalize(v: ArrayLike<number>): Float32Array {
  let sum = 0;
  for (let i = 0; i < v.length; i++) sum += v[i] * v[i];
  const out = new Float32Array(v.length);
  const n = Math.sqrt(sum);
  if (!n || !Number.isFinite(n)) return out;
  for (let i = 0; i < v.length; i++) out[i] = v[i] / n;
  return out;
}

/** The first `dims` numbers of a Matryoshka embedding, unit-length again. */
export function truncate(v: ArrayLike<number>, dims = INDEX_DIMS): Float32Array {
  return normalize(Array.prototype.slice.call(v, 0, Math.min(dims, v.length)) as number[]);
}

/** Cosine similarity of two unit vectors of the same model; 0 when their sizes differ. */
export function dot(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) return 0;
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

/** The `k` nearest items to `q`, best first, at or above `min`. A full scan: an index of a few thousand posts takes
 *  well under a millisecond per thousand at 256 dimensions, so no approximate structure (HNSW) is needed here. */
export function nearest<T extends { vec: Float32Array }>(q: Float32Array, items: Iterable<T>, k: number, min = -1): { item: T; score: number }[] {
  const out: { item: T; score: number }[] = [];
  for (const item of items) {
    const score = dot(q, item.vec);
    if (score < min) continue;
    if (out.length < k) { out.push({ item, score }); out.sort((a, b) => b.score - a.score); }
    else if (score > out[k - 1].score) { out[k - 1] = { item, score }; out.sort((a, b) => b.score - a.score); }
  }
  return out;
}

/** EmbeddingGemma's task prompts (model card): searches and posts are embedded differently. */
export const GEMMA_PROMPT = { query: 'task: search result | query: ', document: 'title: none | text: ' } as const;
export type EmbedKind = keyof typeof GEMMA_PROMPT;
