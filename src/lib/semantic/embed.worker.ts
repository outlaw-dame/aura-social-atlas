/// <reference lib="webworker" />
/**
 * On-device embeddings: Google's EmbeddingGemma (308M parameters, 100+ languages; the best text-only multilingual
 * embedding model under 500M parameters on MTEB when released) run by Transformers.js in this worker, off the main
 * thread. Nothing a person reads or searches leaves the device.
 *
 * - Transformers.js comes from jsDelivr at an exact version, and is run only if its bytes match the SHA-384 of that
 *   version's published npm file (checked here, since a dynamic import can't carry an integrity attribute). It loads
 *   ONNX Runtime Web's WebAssembly from jsDelivr at the version it was built with.
 * - The model is onnx-community/embeddinggemma-300m-ONNX, 4-bit (model_q4: ~197 MB once, under 200 MB of memory),
 *   downloaded from Hugging Face only after the person turns it on, and kept in the browser's Cache Storage.
 *   Licence: Gemma Terms of Use (ai.google.dev/gemma/terms).
 * - WebGPU when the browser has it, else WebAssembly. EmbeddingGemma doesn't support fp16 activations (model card), so
 *   both use the q4 weights with fp32 activations.
 */
import { GEMMA_PROMPT, INDEX_DIMS, truncate, type EmbedKind } from './vectors';

const LIB = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.2/dist/transformers.min.js';
const LIB_SHA384 = 'xFDNfwR3J/vPYzGjMr1VSM8LHIcA+ii2Ha4x+6WAuISKpT9I0dxgF/mVQW+I0kSd';
export const LOCAL_MODEL = 'onnx-community/embeddinggemma-300m-ONNX';

type In = { type: 'load' } | { type: 'embed'; id: number; texts: string[]; kind: EmbedKind };
export type Out =
  | { type: 'progress'; loaded: number; total: number }
  | { type: 'ready'; device: 'webgpu' | 'wasm' }
  | { type: 'failed'; reason: 'blocked' | 'unsupported' | 'download' }
  | { type: 'embedded'; id: number; vectors: Float32Array[] }
  | { type: 'error'; id: number };

type Lib = {
  env: { allowLocalModels: boolean; useBrowserCache: boolean };
  AutoTokenizer: { from_pretrained(id: string, o?: unknown): Promise<(texts: string[], o: unknown) => unknown> };
  AutoModel: { from_pretrained(id: string, o?: unknown): Promise<(inputs: unknown) => Promise<{ sentence_embedding: { tolist(): number[][] } }>> };
};

let loading: Promise<{ tokenizer: Awaited<ReturnType<Lib['AutoTokenizer']['from_pretrained']>>; model: Awaited<ReturnType<Lib['AutoModel']['from_pretrained']>> }> | null = null;
const post = (m: Out, transfer: Transferable[] = []) => (self as unknown as DedicatedWorkerGlobalScope).postMessage(m, transfer);

async function lib(): Promise<Lib> {
  const res = await fetch(LIB, { credentials: 'omit', referrerPolicy: 'no-referrer' });
  if (!res.ok) throw new Error('blocked');
  const bytes = await res.arrayBuffer();
  const digest = btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.digest('SHA-384', bytes))));
  if (digest !== LIB_SHA384) throw new Error('blocked');
  const url = URL.createObjectURL(new Blob([bytes], { type: 'text/javascript' }));
  try { return (await import(/* @vite-ignore */ url)) as Lib; } finally { URL.revokeObjectURL(url); }
}

async function hasWebGpu(): Promise<boolean> {
  try { const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu; return !!gpu && !!(await gpu.requestAdapter()); } catch { return false; }
}

function load() {
  loading ??= (async () => {
    const t = await lib();
    t.env.allowLocalModels = false;
    t.env.useBrowserCache = true;
    const device = (await hasWebGpu()) ? 'webgpu' : 'wasm';
    // Each file reports its own progress; the model's weights are nearly all of it.
    const files = new Map<string, { loaded: number; total: number }>();
    const progress_callback = (p: { status?: string; file?: string; loaded?: number; total?: number }) => {
      if (p.status !== 'progress' || !p.file || !p.total) return;
      files.set(p.file, { loaded: p.loaded ?? 0, total: p.total });
      let loaded = 0, total = 0;
      for (const f of files.values()) { loaded += f.loaded; total += f.total; }
      post({ type: 'progress', loaded, total });
    };
    const tokenizer = await t.AutoTokenizer.from_pretrained(LOCAL_MODEL, { progress_callback });
    const model = await t.AutoModel.from_pretrained(LOCAL_MODEL, { dtype: 'q4', device, progress_callback });
    post({ type: 'ready', device });
    return { tokenizer, model };
  })();
  loading.catch(e => {
    loading = null;
    post({ type: 'failed', reason: String((e as Error)?.message) === 'blocked' ? 'blocked' : typeof WebAssembly === 'undefined' ? 'unsupported' : 'download' });
  });
  return loading;
}

self.onmessage = async (e: MessageEvent<In>) => {
  const m = e.data;
  if (m.type === 'load') { void load().catch(() => {}); return; }
  try {
    const { tokenizer, model } = await load();
    const inputs = tokenizer(m.texts.map(t => GEMMA_PROMPT[m.kind] + t), { padding: true, truncation: true, max_length: 512 });
    const { sentence_embedding } = await model(inputs);
    const vectors = sentence_embedding.tolist().map(v => truncate(v, INDEX_DIMS));
    post({ type: 'embedded', id: m.id, vectors }, vectors.map(v => v.buffer));
  } catch {
    post({ type: 'error', id: m.id });
  }
};
