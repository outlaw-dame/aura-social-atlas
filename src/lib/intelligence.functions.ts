import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { requireSupabaseAuth } from '@/integrations/supabase/auth-middleware';
import { API_KEY, CLOUDFLARE_ACCOUNT, PROVIDER_IDS, type ProviderId } from './intelligence/providers';
import { MAX_FILTERS, filterKind, normalizeFilterText, type ContentFilter, type FilterAction } from './content-filter';

/**
 * Intelligence: opt-in AI in Atlas with the person's own key. Off until they turn it on, and nothing is sent to an AI
 * provider before then. Keys are encrypted on the server and never come back to the browser (vault.server.ts).
 */

export type AiProblem = 'not-configured' | 'not-ready' | 'bad-key' | 'no-access' | 'rate-limited' | 'unavailable' | 'bad-output' | 'bad-model' | 'storage';
export type SavedKey = { provider: ProviderId; hint: string; models: string[] };
export type IntelligenceStatus = {
  /** The server is set up to keep keys (its encryption secret and tables exist). */ available: boolean;
  enabled: boolean; provider: ProviderId | null; model: string | null; deepMatching: boolean; keys: SavedKey[];
};

const store = () => import('./intelligence/store.server');
const Provider = z.enum(PROVIDER_IDS);
const Uid = z.string().uuid();

function sameSession(expected: string, actual: string) {
  if (expected !== actual) throw new Error('Atlas session changed. Sign in again before continuing.');
}

export const getIntelligence = createServerFn({ method: 'GET' }).middleware([requireSupabaseAuth]).handler(async ({ context }) => (await store()).status(context.userId));

/** Checks a key with its provider (by listing its models), then keeps it, encrypted. */
export const saveAiKey = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth])
  .inputValidator(d => z.object({ expectedAtlasUserId: Uid, provider: Provider, key: z.string().trim().regex(API_KEY), account: z.string().trim().toLowerCase().regex(CLOUDFLARE_ACCOUNT).optional() }).parse(d))
  .handler(async ({ data, context }): Promise<{ status: IntelligenceStatus } | { error: AiProblem }> => {
    sameSession(data.expectedAtlasUserId, context.userId);
    if (data.provider === 'cloudflare' && !data.account) return { error: 'bad-key' };
    const credential = { provider: data.provider, key: data.key, ...(data.provider === 'cloudflare' ? { account: data.account } : {}) };
    try {
      const { listModels } = await import('./intelligence/llm.server');
      const { storeCredential } = await import('./intelligence/vault.server');
      const { chatModels, keyHint } = await import('./intelligence/providers');
      const models = chatModels(data.provider, await listModels(credential)).slice(0, 200);
      if (!models.length) return { error: 'no-access' };
      await storeCredential(context.userId, credential, keyHint(data.key), models);
      // The first key saved becomes the one Atlas uses, with its suggested model.
      const s = await (await store()).readSettings(context.userId);
      if (!s.provider) {
        const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
        await supabaseAdmin.from('atlas_ai_settings').upsert({ user_id: context.userId, enabled: s.enabled, provider: data.provider, model: models[0], deep_matching: s.deep_matching, updated_at: new Date().toISOString() });
      }
      return { status: await (await store()).status(context.userId) };
    } catch (e) {
      return { error: (await store()).problem(e) };
    }
  });

export const removeAiKey = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth])
  .inputValidator(d => z.object({ expectedAtlasUserId: Uid, provider: Provider }).parse(d))
  .handler(async ({ data, context }) => {
    sameSession(data.expectedAtlasUserId, context.userId);
    const { forgetCredential } = await import('./intelligence/vault.server');
    await forgetCredential(context.userId, data.provider);
    const s = await (await store()).readSettings(context.userId);
    if (s.provider === data.provider) {
      const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
      await supabaseAdmin.from('atlas_ai_settings').update({ provider: null, model: null, updated_at: new Date().toISOString() }).eq('user_id', context.userId);
    }
    return (await store()).status(context.userId);
  });

/** Turns Intelligence on or off, and picks the provider, model and how thoroughly filters check posts. */
export const updateIntelligence = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth])
  .inputValidator(d => z.object({ expectedAtlasUserId: Uid, enabled: z.boolean().optional(), provider: Provider.optional(), model: z.string().max(200).optional(), deepMatching: z.boolean().optional() }).parse(d))
  .handler(async ({ data, context }) => {
    sameSession(data.expectedAtlasUserId, context.userId);
    const current = await (await store()).status(context.userId);
    if (!current.available) return current;
    const provider = data.provider ?? current.provider;
    const key = current.keys.find(k => k.provider === provider);
    // A model must be one this key lists; switching provider without a model takes that provider's suggested one.
    const model = key ? (data.model && key.models.includes(data.model) ? data.model : data.provider || !current.model ? key.models[0] : current.model) : null;
    const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
    await supabaseAdmin.from('atlas_ai_settings').upsert({
      user_id: context.userId, enabled: data.enabled ?? current.enabled, provider: key ? provider : null, model: model ?? null,
      deep_matching: data.deepMatching ?? current.deepMatching, updated_at: new Date().toISOString(),
    });
    return (await store()).status(context.userId);
  });

/* ── Keyword filters ─────────────────────────────────────────────────────────────────────────── */

export const listContentFilters = createServerFn({ method: 'GET' }).middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ filters: ContentFilter[] } | { error: AiProblem }> => {
    try { return { filters: await (await store()).filtersOf(context.userId) }; } catch { return { error: 'not-configured' }; }
  });

/** Adds filters (one, or a pasted list); ones already there are left as they are. */
export const addContentFilters = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth])
  .inputValidator(d => z.object({ expectedAtlasUserId: Uid, texts: z.array(z.string().max(400)).min(1).max(MAX_FILTERS), action: z.enum(['hide', 'warn']) }).parse(d))
  .handler(async ({ data, context }): Promise<{ filters: ContentFilter[] } | { error: AiProblem }> => {
    sameSession(data.expectedAtlasUserId, context.userId);
    try {
      const existing = await (await store()).filtersOf(context.userId);
      const have = new Set(existing.map(f => f.text.toLowerCase()));
      const rows = [];
      for (const raw of data.texts) {
        const text = normalizeFilterText(raw);
        if (!text || have.has(text.toLowerCase())) continue;
        have.add(text.toLowerCase());
        rows.push({ user_id: context.userId, text, kind: filterKind(text), action: data.action as FilterAction, semantic: true });
      }
      const room = Math.max(0, MAX_FILTERS - existing.length);
      if (rows.length) {
        const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
        const { error } = await supabaseAdmin.from('atlas_content_filters').insert(rows.slice(0, room));
        if (error) return { error: 'storage' };
      }
      return { filters: await (await store()).filtersOf(context.userId) };
    } catch {
      return { error: 'storage' };
    }
  });

export const updateContentFilter = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth])
  .inputValidator(d => z.object({ expectedAtlasUserId: Uid, id: Uid, action: z.enum(['hide', 'warn']).optional(), semantic: z.boolean().optional() }).parse(d))
  .handler(async ({ data, context }) => {
    sameSession(data.expectedAtlasUserId, context.userId);
    const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
    const patch = { ...(data.action ? { action: data.action } : {}), ...(data.semantic !== undefined ? { semantic: data.semantic } : {}) };
    if (Object.keys(patch).length) await supabaseAdmin.from('atlas_content_filters').update(patch).eq('id', data.id).eq('user_id', context.userId);
    return { filters: await (await store()).filtersOf(context.userId) };
  });

export const deleteContentFilter = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth])
  .inputValidator(d => z.object({ expectedAtlasUserId: Uid, id: Uid }).parse(d))
  .handler(async ({ data, context }) => {
    sameSession(data.expectedAtlasUserId, context.userId);
    const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
    await supabaseAdmin.from('atlas_content_filters').delete().eq('id', data.id).eq('user_id', context.userId);
    return { filters: await (await store()).filtersOf(context.userId) };
  });

/** Asks the AI model for other wordings of one filter and keeps them with it. */
export const expandContentFilter = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth])
  .inputValidator(d => z.object({ expectedAtlasUserId: Uid, id: Uid }).parse(d))
  .handler(async ({ data, context }): Promise<{ filters: ContentFilter[] } | { error: AiProblem }> => {
    sameSession(data.expectedAtlasUserId, context.userId);
    try {
      const ai = await (await store()).activeModel(context.userId);
      if ('problem' in ai) return { error: ai.problem };
      const f = (await (await store()).filtersOf(context.userId)).find(x => x.id === data.id);
      if (!f) return { filters: await (await store()).filtersOf(context.userId) };
      const { expandFilter } = await import('./intelligence/tasks.server');
      const expansions = await expandFilter(ai.credential, ai.model, f);
      const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
      await supabaseAdmin.from('atlas_content_filters').update({ expansions }).eq('id', f.id).eq('user_id', context.userId);
      return { filters: await (await store()).filtersOf(context.userId) };
    } catch (e) {
      return { error: (await store()).problem(e) };
    }
  });

const JudgeInput = z.object({
  posts: z.array(z.object({ n: z.number().int().min(0).max(10_000), text: z.string().max(1600), hashtags: z.array(z.string().max(100)).max(30), candidates: z.array(Uid).max(MAX_FILTERS) })).min(1).max(16),
});

/**
 * Checks posts against the person's filters in context. The filters come from the server's copy, never from the
 * request, and only posts the browser chose to send arrive here: those whose words matched a filter, plus (with deep
 * matching on) every other public post being shown.
 */
export const judgeFilteredPosts = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth])
  .inputValidator(d => JudgeInput.parse(d))
  .handler(async ({ data, context }): Promise<{ verdicts: { n: number; matches: string[] }[] } | { error: AiProblem }> => {
    try {
      const ai = await (await store()).activeModel(context.userId);
      if ('problem' in ai) return { error: ai.problem };
      const filters = (await (await store()).filtersOf(context.userId)).filter(f => f.semantic);
      if (!filters.length) return { verdicts: data.posts.map(p => ({ n: p.n, matches: [] })) };
      const known = new Set(filters.map(f => f.id));
      const posts = data.posts.map(p => ({ ...p, candidates: p.candidates.filter(id => known.has(id)) }))
        .filter(p => ai.deepMatching || p.candidates.length);
      if (!posts.length) return { verdicts: data.posts.map(p => ({ n: p.n, matches: [] })) };
      const { judgePosts } = await import('./intelligence/tasks.server');
      const found = await judgePosts(ai.credential, ai.model, filters, posts, ai.deepMatching);
      return { verdicts: data.posts.map(p => ({ n: p.n, matches: found.get(p.n) ?? [] })) };
    } catch (e) {
      return { error: (await store()).problem(e) };
    }
  });

/** Suggestions from the filters in place: what they'd miss, and which ones catch the wrong posts. */
export const suggestContentFilters = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth])
  .inputValidator(d => z.object({ expectedAtlasUserId: Uid }).parse(d))
  .handler(async ({ data, context }) => {
    sameSession(data.expectedAtlasUserId, context.userId);
    try {
      const ai = await (await store()).activeModel(context.userId);
      if ('problem' in ai) return { error: ai.problem };
      const filters = await (await store()).filtersOf(context.userId);
      if (!filters.length) return { suggestions: [], cautions: [] };
      const { suggestFilters } = await import('./intelligence/tasks.server');
      return await suggestFilters(ai.credential, ai.model, filters);
    } catch (e) {
      return { error: (await store()).problem(e) };
    }
  });

