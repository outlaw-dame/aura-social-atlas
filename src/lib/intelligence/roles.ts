/**
 * Which saved key and model does which job. Pure, so it can be tested without a database.
 *
 * - **main**: what the person does themselves — the assistant, alt text, translation, writing and suggesting filters,
 *   search wordings. Uses the main key, then (with backup on) their other keys in the order they were added.
 * - **background**: work that runs on its own while feeds are open — checking posts against keyword filters, and the
 *   semantic index's embeddings. Uses its own key and model when the person chose one, else the main ones. Its backups
 *   never include the main key, so background work can't use up what the person's own requests need.
 *
 * A key's own model is the one chosen for it, else the first its provider lists (a fast, inexpensive one).
 */
import { EMBEDDING_MODELS } from './embeddings';
import type { ProviderId } from './providers';

export type Role = 'main' | 'background';
export type RoleKey = { id: string; provider: ProviderId; models: string[]; model: string | null };
export type RoleSettings = { mainKey: string | null; mainModel: string | null; backgroundKey: string | null; backgroundModel: string | null; fallback: boolean };
export type Pick = { keyId: string; provider: ProviderId; model: string };

const listed = (k: RoleKey, m: string | null | undefined) => (m && k.models.includes(m) ? m : null);
export const keyModel = (k: RoleKey) => listed(k, k.model) ?? k.models[0] ?? null;

/** The main key and model, or null when there's no main key (Intelligence isn't ready). */
export function mainPick(s: RoleSettings, keys: RoleKey[]): Pick | null {
  const k = keys.find(x => x.id === s.mainKey);
  const model = k ? listed(k, s.mainModel) ?? keyModel(k) : null;
  return k && model ? { keyId: k.id, provider: k.provider, model } : null;
}

/** The background key and model: its own when chosen (and still saved), else the main ones. */
export function backgroundPick(s: RoleSettings, keys: RoleKey[]): Pick | null {
  const main = mainPick(s, keys);
  if (!main) return null;
  const k = s.backgroundKey ? keys.find(x => x.id === s.backgroundKey) : undefined;
  if (!k) return main;
  const model = listed(k, s.backgroundModel) ?? (k.id === main.keyId ? main.model : keyModel(k));
  return model ? { keyId: k.id, provider: k.provider, model } : main;
}

/** The keys to try for a job, first choice first. Empty when Intelligence has no main key. */
export function plan(role: Role, s: RoleSettings, keys: RoleKey[]): Pick[] {
  const main = mainPick(s, keys);
  if (!main) return [];
  const first = role === 'main' ? main : backgroundPick(s, keys)!;
  if (!s.fallback) return [first];
  const others = keys
    .filter(k => k.id !== first.keyId && !(role === 'background' && k.id === main.keyId))
    .flatMap(k => { const model = keyModel(k); return model ? [{ keyId: k.id, provider: k.provider, model }] : []; });
  return [first, ...others];
}

/**
 * The key for the semantic index's embeddings: the first background key whose provider has an embedding model, else
 * the main key's. Only one, never a backup: vectors from different models can't be compared, so switching models
 * would split the index.
 */
export function embeddingPick(s: RoleSettings, keys: RoleKey[]): Pick | null {
  const main = mainPick(s, keys);
  if (!main) return null;
  const chain = [...plan('background', { ...s, fallback: true }, keys), main];
  return chain.find(p => !!EMBEDDING_MODELS[p.provider]) ?? null;
}
