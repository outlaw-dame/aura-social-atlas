/** Intelligence settings, keys and filters as stored; server-only helpers for intelligence.functions.ts and /api/chat. */
import { supabaseAdmin } from '@/integrations/supabase/client.server';
import { ProviderError } from './llm';
import { VaultError, credentialById, savedKeys, vaultReady, type Credential, type KeyRow } from './vault.server';
import { backgroundPick, embeddingPick, mainPick, plan, type Pick, type Role, type RoleSettings } from './roles';
import { FILTER_PLACES, MAX_FILTERS, type ContentFilter, type FilterPlace } from '../content-filter';
import type { AiProblem, IntelligenceStatus } from '../intelligence.functions';

/** A provider or storage failure as a code the page can explain; anything unexpected is "unavailable". */
export function problem(e: unknown): AiProblem {
  if (e instanceof ProviderError) return e.code;
  if (e instanceof VaultError) return e.code === 'unreadable' ? 'bad-key' : e.code;
  if (e instanceof Error && e.message === 'bad-output') return 'bad-output';
  // Not a provider's answer (those are logged in llm.ts): say what kind of error it was, so it can be traced.
  // Only the error's class and a short code, never its message or the user.
  const code = (e as { code?: unknown } | null)?.code;
  console.warn(JSON.stringify({ event: 'ai.unexpected_error', name: e instanceof Error ? e.name.slice(0, 60) : typeof e, code: typeof code === 'string' && /^[A-Za-z0-9_.:-]{1,64}$/.test(code) ? code : undefined, storage: !!(e as { storage?: unknown } | null)?.storage }));
  return 'unavailable';
}

export type SettingsRow = {
  enabled: boolean; provider: string | null; model: string | null; deep_matching: boolean;
  main_key: string | null; background_key: string | null; background_model: string | null; fallback: boolean;
};
const NO_SETTINGS: SettingsRow = { enabled: false, provider: null, model: null, deep_matching: false, main_key: null, background_key: null, background_model: null, fallback: true };

export async function readSettings(userId: string): Promise<SettingsRow> {
  const { data, error } = await supabaseAdmin.from('atlas_ai_settings').select('enabled, provider, model, deep_matching, main_key, background_key, background_model, fallback').eq('user_id', userId).maybeSingle();
  if (error) throw Object.assign(new Error('storage'), { storage: true });
  return (data as SettingsRow | null) ?? NO_SETTINGS;
}

export const roleSettings = (s: SettingsRow): RoleSettings => ({ mainKey: s.main_key, mainModel: s.model, backgroundKey: s.background_key, backgroundModel: s.background_model, fallback: s.fallback });

/** Writes settings, keeping the older provider column in step with the main key (read by earlier builds). */
export async function writeSettings(userId: string, s: SettingsRow, keys: KeyRow[]) {
  const main = mainPick(roleSettings(s), keys);
  const { error } = await supabaseAdmin.from('atlas_ai_settings').upsert({
    user_id: userId, enabled: s.enabled, deep_matching: s.deep_matching, fallback: s.fallback,
    main_key: main?.keyId ?? null, provider: main?.provider ?? null, model: main?.model ?? null,
    background_key: main && s.background_key && keys.some(k => k.id === s.background_key) ? s.background_key : null,
    background_model: main && s.background_key ? s.background_model : null,
    updated_at: new Date().toISOString(),
  });
  if (error) throw Object.assign(new Error('storage'), { storage: true });
}

/** Settings as the page sees them. `available` means the tables exist; `serverKeys` that keys can be kept here. */
export async function status(userId: string): Promise<IntelligenceStatus> {
  const off: IntelligenceStatus = { available: false, serverKeys: false, enabled: false, provider: null, model: null, mainKey: null, background: null, fallback: true, embeddingProvider: null, deepMatching: false, keys: [] };
  try {
    const s = await readSettings(userId);
    const serverKeys = await vaultReady();
    const keys = serverKeys ? await savedKeys(userId) : [];
    const rs = roleSettings(s), main = mainPick(rs, keys), bg = backgroundPick(rs, keys);
    return {
      available: true, serverKeys, enabled: s.enabled, deepMatching: s.deep_matching, fallback: s.fallback,
      provider: main?.provider ?? null, model: main?.model ?? null, mainKey: main?.keyId ?? null,
      background: main && bg && s.background_key && keys.some(k => k.id === s.background_key) ? { key: bg.keyId, provider: bg.provider, model: bg.model } : null,
      embeddingProvider: embeddingPick(rs, keys)?.provider ?? null,
      keys,
    };
  } catch {
    return off;
  }
}

/** The key and model to use right now, or the reason there are none. */
export type ActiveModel = { problem: AiProblem } | { credential: Credential; model: string; deepMatching: boolean; keyId: string };

/* ── Backups ─────────────────────────────────────────────────────────────────────────────────── */

/** Failures another key may not have: limits, outages, a key that stopped working, a model this key can't use. */
const TRY_NEXT = new Set<AiProblem>(['rate-limited', 'unavailable', 'bad-key', 'no-access', 'no-credit', 'bad-model', 'no-vision']);
/** Keys a provider is limiting, and until when (per server instance). Background work leaves them alone; the
 *  person's own requests try them last. */
const resting = new Map<string, number>();
const REST_MS = 60_000;
/** A key whose account is out of credit (HTTP 402; Gemini since Sep 2026) rests longer: retrying won't help until
 *  someone adds credit, and background work (filters, the semantic index) would otherwise ask on every feed load. */
const NO_CREDIT_REST_MS = 10 * 60_000;
/** Rests a key after a failure that waiting may fix: a rate limit (60 s) or an account out of credit (10 min). */
function rest(keyId: string, code: AiProblem) {
  if (code === 'rate-limited') resting.set(keyId, Date.now() + REST_MS);
  else if (code === 'no-credit') resting.set(keyId, Date.now() + NO_CREDIT_REST_MS);
}
/** Keys out of credit, so a background request for one can answer at once without asking the provider. */
const noCredit = new Set<string>();
export const _resetResting = () => { resting.clear(); noCredit.clear(); };
const isResting = (keyId: string) => (resting.get(keyId) ?? 0) > Date.now();

/** Puts the keys to try in order: background work skips resting keys; the person's own requests try them last. */
export function arrange(role: Role, picks: Pick[]): Pick[] {
  const fresh = picks.filter(p => !isResting(p.keyId));
  return role === 'background' ? fresh : [...fresh, ...picks.filter(p => isResting(p.keyId))];
}

/**
 * Runs an AI job with the first key that works: the role's own key, then (with backup on) the person's others. A
 * failure that another key won't fix (an unusable answer) stops there. Resolves to the value, or the problem the
 * first key had (the one the person chose, which is the one worth explaining).
 */
export async function withAi<T>(userId: string, role: Role, job: (c: Credential, model: string, deepMatching: boolean) => Promise<T>): Promise<{ value: T } | { problem: AiProblem }> {
  let s: SettingsRow, keys: KeyRow[];
  try { s = await readSettings(userId); keys = await savedKeys(userId); } catch (e) { return { problem: e instanceof VaultError ? problem(e) : 'storage' }; }
  return runWithKeys(s, keys, id => credentialById(userId, id), role, job);
}

/** withAi's choosing and retrying, given the settings, the keys and a way to open one (separate so it can be tested
 *  without a database). */
export async function runWithKeys<T>(s: SettingsRow, keys: KeyRow[], open: (keyId: string) => Promise<Credential | null>, role: Role, job: (c: Credential, model: string, deepMatching: boolean) => Promise<T>): Promise<{ value: T } | { problem: AiProblem }> {
  if (!s.enabled) return { problem: 'not-ready' };
  const all = plan(role, roleSettings(s), keys);
  if (!all.length) return { problem: 'not-ready' };
  const picks = arrange(role, all);
  // Background work with every key resting: say why, without asking the provider again.
  if (!picks.length) return { problem: all.every(p => noCredit.has(p.keyId)) ? 'no-credit' : 'rate-limited' };
  let first: AiProblem | null = null;
  for (const p of picks) {
    try {
      const c = await open(p.keyId);
      if (!c) continue;
      const value = await job(c, p.model, s.deep_matching);
      noCredit.delete(p.keyId);
      return { value };
    } catch (e) {
      const code = problem(e);
      rest(p.keyId, code);
      if (code === 'no-credit') noCredit.add(p.keyId); else noCredit.delete(p.keyId);
      first ??= code;
      if (!TRY_NEXT.has(code)) break;
    }
  }
  return { problem: first ?? 'not-ready' };
}

/** The single key and model for a job that can't switch partway (a streamed reply): the first that isn't resting. */
export async function activeModel(userId: string, role: Role = 'main'): Promise<ActiveModel> {
  const s = await readSettings(userId);
  if (!s.enabled) return { problem: 'not-ready' };
  const keys = await savedKeys(userId);
  const picks = arrange(role, plan(role, roleSettings(s), keys));
  for (const p of picks) {
    const credential = await credentialById(userId, p.keyId);
    if (credential) return { credential, model: p.model, deepMatching: s.deep_matching, keyId: p.keyId };
  }
  return { problem: 'not-ready' };
}

/**
 * The key for the semantic index's embeddings (roles.ts embeddingPick), or why there's none. One key only, so a key
 * resting after a rate limit or running out of credit answers that at once rather than asking the provider again.
 */
export async function embeddingModel(userId: string): Promise<{ credential: Credential; keyId: string } | { problem: AiProblem }> {
  const s = await readSettings(userId);
  if (!s.enabled) return { problem: 'not-ready' };
  const p = embeddingPick(roleSettings(s), await savedKeys(userId));
  if (!p) return { problem: 'bad-model' };
  if (isResting(p.keyId)) return { problem: noCredit.has(p.keyId) ? 'no-credit' : 'rate-limited' };
  const credential = await credentialById(userId, p.keyId);
  return credential ? { credential, keyId: p.keyId } : { problem: 'not-ready' };
}

/** Records how an embeddings request with a key went (rests it after a limit or no credit). */
export function noteEmbedding(keyId: string, e: unknown | null) {
  if (e === null) { noCredit.delete(keyId); return; }
  const code = problem(e);
  rest(keyId, code);
  if (code === 'no-credit') noCredit.add(keyId);
}

/** Rests a key the provider is limiting, from the streamed assistant (the AI SDK's errors carry `statusCode`). */
export function noteFailure(keyId: string, e: unknown) {
  const status = (e as { statusCode?: unknown } | null)?.statusCode;
  const code = status === 429 ? 'rate-limited' : status === 402 ? 'no-credit' : problem(e);
  rest(keyId, code);
  if (code === 'no-credit') noCredit.add(keyId);
}

/* ── Keyword filters ─────────────────────────────────────────────────────────────────────────── */

type FilterRow = { id: string; text: string; kind: string; action: string; semantic: boolean; expansions: unknown; places: string[] | null; expires_at: string | null; except_following: boolean };
const fromRow = (r: FilterRow): ContentFilter => ({
  id: r.id, text: r.text, kind: r.kind as ContentFilter['kind'], action: r.action === 'warn' || r.action === 'blur' ? r.action : 'hide', semantic: r.semantic,
  expansions: Array.isArray(r.expansions) ? r.expansions.filter((x): x is string => typeof x === 'string') : [],
  places: (r.places ?? [...FILTER_PLACES]).filter((p): p is FilterPlace => (FILTER_PLACES as readonly string[]).includes(p)),
  expiresAt: r.expires_at, exceptFollowing: r.except_following,
});

export const FILTER_COLUMNS = 'id, text, kind, action, semantic, expansions, places, expires_at, except_following';

export async function filtersOf(userId: string): Promise<ContentFilter[]> {
  const { data, error } = await supabaseAdmin.from('atlas_content_filters').select(FILTER_COLUMNS).eq('user_id', userId).order('created_at').limit(MAX_FILTERS);
  if (error) throw Object.assign(new Error('storage'), { storage: true });
  return (data ?? []).map(r => fromRow(r as unknown as FilterRow));
}

/** For the assistant chat route: the key and model to stream with, or why there are none. */
export async function assistantModel(userId: string): Promise<ActiveModel> {
  try { return await activeModel(userId, 'main'); } catch (e) { return { problem: problem(e) }; }
}
