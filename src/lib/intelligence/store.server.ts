/** Intelligence settings, keys and filters as stored; server-only helpers for intelligence.functions.ts and /api/chat. */
import { supabaseAdmin } from '@/integrations/supabase/client.server';
import { ProviderError } from './llm';
import { VaultError, credentialFor, savedKeys, vaultReady, type Credential } from './vault.server';
import type { ProviderId } from './providers';
import { FILTER_PLACES, MAX_FILTERS, type ContentFilter, type FilterPlace } from '../content-filter';
import type { AiProblem, IntelligenceStatus } from '../intelligence.functions';

/** A provider or storage failure as a code the page can explain; anything unexpected is "unavailable". */
export function problem(e: unknown): AiProblem {
  if (e instanceof ProviderError) return e.code;
  if (e instanceof VaultError) return e.code === 'unreadable' ? 'bad-key' : e.code;
  if (e instanceof Error && e.message === 'bad-output') return 'bad-output';
  return 'unavailable';
}

type SettingsRow = { enabled: boolean; provider: string | null; model: string | null; deep_matching: boolean };

export async function readSettings(userId: string): Promise<SettingsRow> {
  const { data, error } = await supabaseAdmin.from('atlas_ai_settings').select('enabled, provider, model, deep_matching').eq('user_id', userId).maybeSingle();
  if (error) throw Object.assign(new Error('storage'), { storage: true });
  return data ?? { enabled: false, provider: null, model: null, deep_matching: false };
}

/** Settings as the page sees them. `available` means the tables exist; `serverKeys` that keys can be kept here. */
export async function status(userId: string): Promise<IntelligenceStatus> {
  const off: IntelligenceStatus = { available: false, serverKeys: false, enabled: false, provider: null, model: null, deepMatching: false, keys: [] };
  try {
    const s = await readSettings(userId);
    const serverKeys = await vaultReady();
    const keys = serverKeys ? await savedKeys(userId) : [];
    const provider = keys.some(k => k.provider === s.provider) ? (s.provider as ProviderId) : null;
    return { available: true, serverKeys, enabled: s.enabled, provider, model: provider ? s.model : null, deepMatching: s.deep_matching, keys: keys.map(({ provider, hint, models }) => ({ provider, hint, models })) };
  } catch {
    return off;
  }
}

/** The key and model to use right now, or the reason there are none. */
export type ActiveModel = { problem: AiProblem } | { credential: Credential; model: string; deepMatching: boolean };

export async function activeModel(userId: string): Promise<ActiveModel> {
  const s = await readSettings(userId);
  if (!s.enabled || !s.provider || !s.model) return { problem: 'not-ready' as const };
  const credential = await credentialFor(userId, s.provider as ProviderId);
  if (!credential) return { problem: 'not-ready' as const };
  return { credential, model: s.model, deepMatching: s.deep_matching };
}

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
  try { return await activeModel(userId); } catch (e) { return { problem: problem(e) }; }
}
