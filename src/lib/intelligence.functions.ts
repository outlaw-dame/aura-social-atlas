import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { requireSupabaseAuth } from '@/integrations/supabase/auth-middleware';
import { API_KEY, CLOUDFLARE_ACCOUNT, PROVIDER_IDS, type ProviderId } from './intelligence/providers';
import { FILTER_PLACES, MAX_EXPANSIONS, MAX_FILTERS, filterKind, normalizeFilterText, type ContentFilter } from './content-filter';

/**
 * Intelligence: opt-in AI in Atlas with the person's own key. Off until they turn it on, and nothing is sent to an AI
 * provider before then. Keys kept on Atlas's server are encrypted there and never come back to the browser
 * (vault.server.ts); a key kept on the device only never reaches these functions (device-keys.ts).
 */

export type AiProblem = 'not-configured' | 'not-ready' | 'bad-key' | 'no-access' | 'rate-limited' | 'unavailable' | 'bad-output' | 'bad-model' | 'browser-blocked' | 'no-vision' | 'storage';
export type SavedKey = { provider: ProviderId; hint: string; models: string[] };
export type IntelligenceStatus = {
  /** Atlas's Intelligence tables exist (settings and filters can be kept). */ available: boolean;
  /** The server can keep keys (its encryption secret is set). */ serverKeys: boolean;
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
    const { vaultReady } = await import('./intelligence/vault.server');
    if (!(await vaultReady())) return { error: 'not-configured' };
    const credential = { provider: data.provider, key: data.key, ...(data.provider === 'cloudflare' ? { account: data.account } : {}) };
    try {
      const { listModels } = await import('./intelligence/llm');
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

const Place = z.enum(FILTER_PLACES as [string, ...string[]]);
const Options = {
  action: z.enum(['hide', 'warn', 'blur']),
  places: z.array(Place).min(1).max(3),
  expiresAt: z.string().datetime().nullable(),
  exceptFollowing: z.boolean(),
};
const Wordings = z.array(z.string().max(120)).max(MAX_EXPANSIONS);
/** Wordings as the person edited them: cleaned, at most 60 characters each, no repeats, not the filter itself. */
function cleanWordings(list: string[], own: string): string[] {
  const seen = new Set([own.toLowerCase()]), out: string[] = [];
  for (const w of list) {
    const t = normalizeFilterText(w)?.slice(0, 60);
    if (t && !seen.has(t.toLowerCase())) { seen.add(t.toLowerCase()); out.push(t); }
  }
  return out.slice(0, MAX_EXPANSIONS);
}

/** Adds filters (one, a pasted list, or an import); ones already there are left as they are. */
export const addContentFilters = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth])
  .inputValidator(d => z.object({ expectedAtlasUserId: Uid, texts: z.array(z.string().max(400)).min(1).max(MAX_FILTERS), ...Options }).parse(d))
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
        rows.push({ user_id: context.userId, text, kind: filterKind(text), action: data.action, semantic: true, places: data.places, expires_at: data.expiresAt, except_following: data.exceptFollowing });
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

/** Changes a filter: what it does, where and until when, whether it's checked in context, its wordings. */
export const updateContentFilter = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth])
  .inputValidator(d => z.object({
    expectedAtlasUserId: Uid, id: Uid, semantic: z.boolean().optional(), expansions: Wordings.optional(),
    action: Options.action.optional(), places: Options.places.optional(), expiresAt: Options.expiresAt.optional(), exceptFollowing: Options.exceptFollowing.optional(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    sameSession(data.expectedAtlasUserId, context.userId);
    const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
    const own = (await (await store()).filtersOf(context.userId)).find(f => f.id === data.id);
    const patch = {
      ...(data.action ? { action: data.action } : {}), ...(data.semantic !== undefined ? { semantic: data.semantic } : {}),
      ...(data.expansions && own ? { expansions: cleanWordings(data.expansions, own.text) } : {}),
      ...(data.places ? { places: data.places } : {}), ...(data.expiresAt !== undefined ? { expires_at: data.expiresAt } : {}),
      ...(data.exceptFollowing !== undefined ? { except_following: data.exceptFollowing } : {}),
    };
    if (own && Object.keys(patch).length) await supabaseAdmin.from('atlas_content_filters').update(patch).eq('id', data.id).eq('user_id', context.userId);
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
      const { expandFilter } = await import('./intelligence/tasks');
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
      const { judgeWith } = await import('./intelligence/tasks');
      return { verdicts: await judgeWith(ai.credential, ai.model, await (await store()).filtersOf(context.userId), data.posts, ai.deepMatching) };
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
      const { suggestFilters } = await import('./intelligence/tasks');
      return await suggestFilters(ai.credential, ai.model, filters);
    } catch (e) {
      return { error: (await store()).problem(e) };
    }
  });


/** "Filter posts like this": a topic filter describing the post, for the person to edit before adding. */
export const describePostForFilter = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth])
  .inputValidator(d => z.object({ expectedAtlasUserId: Uid, text: z.string().min(1).max(1600) }).parse(d))
  .handler(async ({ data, context }): Promise<{ filter: string } | { error: AiProblem }> => {
    sameSession(data.expectedAtlasUserId, context.userId);
    try {
      const ai = await (await store()).activeModel(context.userId);
      if ('problem' in ai) return { error: ai.problem };
      const { describePost } = await import('./intelligence/tasks');
      return { filter: await describePost(ai.credential, ai.model, data.text) };
    } catch (e) {
      return { error: (await store()).problem(e) };
    }
  });

/**
 * Which of these accounts the person follows on Fedizen, for filters that skip people they follow. Reads
 * /api/v1/accounts/relationships (40 ids at most, already on the READS allowlist). Unknown when not connected.
 */
export const followingAmong = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth])
  .inputValidator(d => z.object({ expectedAtlasUserId: Uid, ids: z.array(z.string().regex(/^[A-Za-z0-9_-]{1,64}$/)).min(1).max(40) }).parse(d))
  .handler(async ({ data, context }): Promise<{ following: Record<string, boolean> } | { error: 'not-connected' | 'unavailable' }> => {
    sameSession(data.expectedAtlasUserId, context.userId);
    const { tokenFor, fedizenGet } = await import('./fedizen.server');
    const t = await tokenFor(context.userId);
    if (!t) return { error: 'not-connected' };
    const q = [...new Set(data.ids)].map(id => `id%5B%5D=${encodeURIComponent(id)}`).join('&');
    const r = await fedizenGet(t.access_token, `/api/v1/accounts/relationships?${q}`).catch(() => null);
    if (!r || r.status !== 200) return { error: 'unavailable' };
    const following: Record<string, boolean> = {};
    for (const id of data.ids) following[id] = false;
    for (const rel of r.data as { id: string; following?: boolean | null }[]) if (rel.id in following) following[rel.id] = rel.following === true;
    return { following };
  });

/** Alt text for an image being posted, from the person's AI model on Atlas's server (vision). The image arrives
 *  already scaled down in the browser (lib/prepare-image: describable), so it's small. */
export const altTextForImage = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth])
  .inputValidator(d => z.object({
    expectedAtlasUserId: Uid,
    image: z.object({ data: z.string().min(16).max(2_800_000).regex(/^[A-Za-z0-9+/]+=*$/), mediaType: z.enum(['image/jpeg', 'image/png', 'image/gif']) }),
    text: z.string().max(5000).default(''),
  }).parse(d))
  .handler(async ({ data, context }): Promise<{ alt: string } | { error: AiProblem }> => {
    sameSession(data.expectedAtlasUserId, context.userId);
    try {
      const ai = await (await store()).activeModel(context.userId);
      if ('problem' in ai) return { error: ai.problem };
      const { writeAltText } = await import('./intelligence/tasks');
      return { alt: await writeAltText(ai.credential, ai.model, data.image, data.text) };
    } catch (e) {
      return { error: (await store()).problem(e) };
    }
  });
