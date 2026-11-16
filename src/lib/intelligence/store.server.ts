/** Intelligence settings, keys and filters as stored; server-only helpers for intelligence.functions.ts and /api/chat. */
import { supabaseAdmin } from '@/integrations/supabase/client.server';
import { ProviderError } from './llm.server';
import { VaultError, credentialFor, savedKeys, vaultReady, type Credential } from './vault.server';
import type { ProviderId } from './providers';
import { MAX_FILTERS, type ContentFilter } from '../content-filter';
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

export async function status(userId: string): Promise<IntelligenceStatus> {
  const off: IntelligenceStatus = { available: false, enabled: false, provider: null, model: null, deepMatching: false, keys: [] };
  if (!(await vaultReady())) return off;
  try {
    const [s, keys] = await Promise.all([readSettings(userId), savedKeys(userId)]);
    const provider = keys.some(k => k.provider === s.provider) ? (s.provider as ProviderId) : null;
    return { available: true, enabled: s.enabled, provider, model: provider ? s.model : null, deepMatching: s.deep_matching, keys: keys.map(({ provider, hint, models }) => ({ provider, hint, models })) };
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

type FilterRow = { id: string; text: string; kind: string; action: string; semantic: boolean; expansions: unknown };
const fromRow = (r: FilterRow): ContentFilter => ({
  id: r.id, text: r.text, kind: r.kind as ContentFilter['kind'], action: r.action === 'warn' ? 'warn' : 'hide', semantic: r.semantic,
  expansions: Array.isArray(r.expansions) ? r.expansions.filter((x): x is string => typeof x === 'string') : [],
});

export async function filtersOf(userId: string): Promise<ContentFilter[]> {
  const { data, error } = await supabaseAdmin.from('atlas_content_filters').select('id, text, kind, action, semantic, expansions').eq('user_id', userId).order('created_at').limit(MAX_FILTERS);
  if (error) throw Object.assign(new Error('storage'), { storage: true });
  return (data ?? []).map(fromRow);
}

/** For the assistant chat route: the key and model to stream with, or why there are none. */
export async function assistantModel(userId: string): Promise<ActiveModel> {
  try { return await activeModel(userId); } catch (e) { return { problem: problem(e) }; }
}
