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
const TRY_NEXT = new Set<AiProblem>(['rate-limited', 'unavailable', 'bad-key', 'no-access', 'bad-model', 'no-vision']);
/** Keys a provider is limiting, and until when (per server instance). Background work leaves them alone; the
 *  person's own requests try them last. */
const resting = new Map<string, number>();
const REST_MS = 60_000;
export const _resetResting = () => resting.clear();
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
  if (!picks.length) return { problem: 'rate-limited' };
  let first: AiProblem | null = null;
  for (const p of picks) {
    try {
      const c = await open(p.keyId);
      if (!c) continue;
      return { value: await job(c, p.model, s.deep_matching) };
    } catch (e) {
      const code = problem(e);
      if (code === 'rate-limited') resting.set(p.keyId, Date.now() + REST_MS);
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

/** The key for the semantic index's embeddings (roles.ts embeddingPick), or why there's none. */
export async function embeddingModel(userId: string): Promise<{ credential: Credential } | { problem: AiProblem }> {
  const s = await readSettings(userId);
  if (!s.enabled) return { problem: 'not-ready' };
  const p = embeddingPick(roleSettings(s), await savedKeys(userId));
  if (!p) return { problem: 'bad-model' };
  const credential = await credentialById(userId, p.keyId);
  return credential ? { credential } : { problem: 'not-ready' };
}

/** Rests a key the provider is limiting, from the streamed assistant (the AI SDK's errors carry `statusCode`). */
export function noteFailure(keyId: string, e: unknown) {
  const status = (e as { statusCode?: unknown } | null)?.statusCode;
  if (problem(e) === 'rate-limited' || status === 429) resting.set(keyId, Date.now() + REST_MS);
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
