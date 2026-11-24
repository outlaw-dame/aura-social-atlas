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

export type AiProblem = 'not-configured' | 'not-ready' | 'bad-key' | 'no-access' | 'no-credit' | 'rate-limited' | 'unavailable' | 'bad-output' | 'bad-model' | 'browser-blocked' | 'no-vision' | 'storage';
/** A key on Atlas's server: never the key itself, only its last four characters. `model`: the one chosen for it
 *  (used when it's a backup or does background work). */
export type SavedKey = { id: string; provider: ProviderId; label: string | null; hint: string; models: string[]; model: string | null };
export type IntelligenceStatus = {
  /** Atlas's Intelligence tables exist (settings and filters can be kept). */ available: boolean;
  /** The server can keep keys (its encryption secret is set). */ serverKeys: boolean;
  enabled: boolean;
  /** The main key: its company, model and id (the assistant, alt text, translation, writing filters). */
  provider: ProviderId | null; model: string | null; mainKey: string | null;
  /** Background filtering's own key and model; null means it uses the main ones. */
  background: { key: string; provider: ProviderId; model: string } | null;
  /** Try the person's other keys when the one in use is refusing or limited. */
  fallback: boolean;
  /** Whose embedding model the semantic index uses with server keys (Anthropic and Kimi have none). */
  embeddingProvider: ProviderId | null;
  deepMatching: boolean; keys: SavedKey[];
};

const store = () => import('./intelligence/store.server');
const Provider = z.enum(PROVIDER_IDS);
const Uid = z.string().uuid();
const Label = z.string().trim().min(1).max(40);
const Model = z.string().min(1).max(200);

function sameSession(expected: string, actual: string) {
  if (expected !== actual) throw new Error('Atlas session changed. Sign in again before continuing.');
}

export const getIntelligence = createServerFn({ method: 'GET' }).middleware([requireSupabaseAuth]).handler(async ({ context }) => (await store()).status(context.userId));

/** Checks a key with its provider (by listing its models), then keeps it, encrypted. */
export const saveAiKey = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth])
  .inputValidator(d => z.object({ expectedAtlasUserId: Uid, provider: Provider, key: z.string().trim().regex(API_KEY), account: z.string().trim().toLowerCase().regex(CLOUDFLARE_ACCOUNT).optional(), label: Label.optional() }).parse(d))
  .handler(async ({ data, context }): Promise<{ status: IntelligenceStatus } | { error: AiProblem }> => {
    sameSession(data.expectedAtlasUserId, context.userId);
    if (data.provider === 'cloudflare' && !data.account) return { error: 'bad-key' };
    const { vaultReady } = await import('./intelligence/vault.server');
    if (!(await vaultReady())) return { error: 'not-configured' };
    const credential = { provider: data.provider, key: data.key, ...(data.provider === 'cloudflare' ? { account: data.account } : {}) };
    try {
      const { listModels } = await import('./intelligence/llm');
      const { addCredential, savedKeys } = await import('./intelligence/vault.server');
      const { chatModels, isEmbeddingsOnly, keyHint } = await import('./intelligence/providers');
      if (isEmbeddingsOnly(data.provider)) {
        // A key for embeddings only: checked by embedding one word, kept with no chat models (never a main key).
        const { embedWith } = await import('./intelligence/embeddings');
        await embedWith(credential, ['Atlas'], 'query');
        await addCredential(context.userId, credential, keyHint(data.key), [], { label: data.label ?? null, model: null });
        return { status: await (await store()).status(context.userId) };
      }
      const models = chatModels(data.provider, await listModels(credential)).slice(0, 200);
      if (!models.length) return { error: 'no-access' };
      const keyId = await addCredential(context.userId, credential, keyHint(data.key), models, { label: data.label ?? null, model: models[0] });
      // The first key saved (or the first since the main one was removed) becomes the main key.
      const st = await store();
      const s = await st.readSettings(context.userId), keys = await savedKeys(context.userId);
      if (!keys.some(k => k.id === s.main_key)) await st.writeSettings(context.userId, { ...s, main_key: keyId, model: models[0] }, keys);
      return { status: await st.status(context.userId) };
    } catch (e) {
      return { error: (await store()).problem(e) };
    }
  });

/** Removes one saved key. If it was the main key, the oldest remaining key becomes main; background work that used it
 *  goes back to the main key. */
export const removeAiKey = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth])
  .inputValidator(d => z.object({ expectedAtlasUserId: Uid, keyId: Uid }).parse(d))
  .handler(async ({ data, context }) => {
    sameSession(data.expectedAtlasUserId, context.userId);
    const { forgetKey, savedKeys } = await import('./intelligence/vault.server');
    await forgetKey(context.userId, data.keyId);
    const st = await store();
    const s = await st.readSettings(context.userId), keys = await savedKeys(context.userId);
    const lostMain = s.main_key === data.keyId, lostBackground = s.background_key === data.keyId;
    if (lostMain || lostBackground) {
      const next = lostMain ? keys.find(k => k.models.length > 0) : undefined;
      await st.writeSettings(context.userId, {
        ...s,
        ...(lostMain ? { main_key: next?.id ?? null, model: next ? next.model ?? next.models[0] ?? null : null } : {}),
        ...(lostBackground || (next && s.background_key === next.id) ? { background_key: null, background_model: null } : {}),
      }, keys);
    }
    return st.status(context.userId);
  });

/** Names a saved key ("Work", "Personal") or sets the model it uses as a backup. */
export const updateAiKey = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth])
  .inputValidator(d => z.object({ expectedAtlasUserId: Uid, keyId: Uid, label: Label.nullable().optional(), model: Model.optional() }).parse(d))
  .handler(async ({ data, context }) => {
    sameSession(data.expectedAtlasUserId, context.userId);
    const { savedKeys, updateKeyDetails } = await import('./intelligence/vault.server');
    const key = (await savedKeys(context.userId)).find(k => k.id === data.keyId);
    if (key) await updateKeyDetails(context.userId, key.id, {
      ...(data.label !== undefined ? { label: data.label } : {}),
      ...(data.model && key.models.includes(data.model) ? { model: data.model } : {}),
    });
    return (await store()).status(context.userId);
  });

/**
 * Turns Intelligence on or off and chooses which key and model do what: `main` (the person's own requests),
 * `background` (filtering as feeds load; null goes back to the main key), backups, and how thoroughly filters check.
 * A key must be the person's own and a model one that key lists.
 */
export const updateIntelligence = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth])
  .inputValidator(d => z.object({
    expectedAtlasUserId: Uid, enabled: z.boolean().optional(), deepMatching: z.boolean().optional(), fallback: z.boolean().optional(),
    main: z.object({ key: Uid, model: Model.optional() }).optional(),
    background: z.object({ key: Uid, model: Model.optional() }).nullable().optional(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    sameSession(data.expectedAtlasUserId, context.userId);
    const st = await store();
    const current = await st.status(context.userId);
    if (!current.available) return current;
    const s = await st.readSettings(context.userId), keys = current.keys;
    const pick = (choice: { key: string; model?: string }) => {
      const k = keys.find(x => x.id === choice.key && x.models.length > 0);
      return k ? { key: k.id, model: choice.model && k.models.includes(choice.model) ? choice.model : k.model ?? k.models[0] ?? null } : null;
    };
    const main = data.main ? pick(data.main) : null;
    const background = data.background ? pick(data.background) : null;
    await st.writeSettings(context.userId, {
      ...s,
      enabled: data.enabled ?? s.enabled, deep_matching: data.deepMatching ?? s.deep_matching, fallback: data.fallback ?? s.fallback,
      ...(main ? { main_key: main.key, model: main.model } : {}),
      ...(data.background === null ? { background_key: null, background_model: null } : background ? { background_key: background.key, background_model: background.model } : {}),
    }, keys);
    return st.status(context.userId);
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

/**
 * Changes a filter: its words, what it does, where and until when, whether it's checked in context, its wordings.
 * New words replace the filter's kind and drop its wordings (they were other ways of saying the old words); a filter
 * checked in context gets new ones. Words another filter already has are refused (`taken`).
 */
export const updateContentFilter = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth])
  .inputValidator(d => z.object({
    expectedAtlasUserId: Uid, id: Uid, text: z.string().max(400).optional(), semantic: z.boolean().optional(), expansions: Wordings.optional(),
    action: Options.action.optional(), places: Options.places.optional(), expiresAt: Options.expiresAt.optional(), exceptFollowing: Options.exceptFollowing.optional(),
  }).parse(d))
  .handler(async ({ data, context }): Promise<{ filters: ContentFilter[]; taken?: boolean }> => {
    sameSession(data.expectedAtlasUserId, context.userId);
    const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
    const all = await (await store()).filtersOf(context.userId);
    const own = all.find(f => f.id === data.id);
    const text = data.text !== undefined ? normalizeFilterText(data.text)?.slice(0, 200) : undefined;
    // A blank/invalid rename must not silently return success while leaving the original filter unchanged.
    if (data.text !== undefined && !text) throw new Error('Invalid filter text');
    const renamed = !!own && !!text && text !== own.text;
    if (renamed && all.some(f => f.id !== data.id && f.text.toLowerCase() === text.toLowerCase())) return { filters: all, taken: true };
    const patch = {
      ...(renamed ? { text, kind: filterKind(text), expansions: [] } : {}),
      ...(data.action ? { action: data.action } : {}), ...(data.semantic !== undefined ? { semantic: data.semantic } : {}),
      ...(data.expansions && own ? { expansions: cleanWordings(data.expansions, renamed ? text : own.text) } : {}),
      ...(data.places ? { places: data.places } : {}), ...(data.expiresAt !== undefined ? { expires_at: data.expiresAt } : {}),
      ...(data.exceptFollowing !== undefined ? { except_following: data.exceptFollowing } : {}),
    };
    if (own && Object.keys(patch).length) {
      const { error } = await supabaseAdmin.from('atlas_content_filters').update(patch).eq('id', data.id).eq('user_id', context.userId);
      if (error) throw new Error('Content filter update failed');
    }
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
      const f = (await (await store()).filtersOf(context.userId)).find(x => x.id === data.id);
      if (!f) return { filters: await (await store()).filtersOf(context.userId) };
      const { expandFilter } = await import('./intelligence/tasks');
      const r = await (await store()).withAi(context.userId, 'main', (c, model) => expandFilter(c, model, f));
      if ('problem' in r) return { error: r.problem };
      const expansions = r.value;
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
      const { judgeWith } = await import('./intelligence/tasks');
      const filters = await (await store()).filtersOf(context.userId);
      // Background work: its own key when the person chose one, and never the main key as a backup.
      const r = await (await store()).withAi(context.userId, 'background', (c, model, deep) => judgeWith(c, model, filters, data.posts, deep));
      return 'problem' in r ? { error: r.problem } : { verdicts: r.value };
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
      const filters = await (await store()).filtersOf(context.userId);
      if (!filters.length) return { suggestions: [], cautions: [] };
      const { suggestFilters } = await import('./intelligence/tasks');
      const r = await (await store()).withAi(context.userId, 'main', (c, model) => suggestFilters(c, model, filters));
      return 'problem' in r ? { error: r.problem } : r.value;
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
      const { describePost } = await import('./intelligence/tasks');
      const r = await (await store()).withAi(context.userId, 'main', (c, model) => describePost(c, model, data.text));
      return 'problem' in r ? { error: r.problem } : { filter: r.value };
    } catch (e) {
      return { error: (await store()).problem(e) };
    }
  });

/** Embeddings for the semantic index with the person's server-kept key (device keys embed from the browser). */
export const embedTextsFor = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth])
  .inputValidator(d => z.object({ expectedAtlasUserId: Uid, kind: z.enum(['query', 'document']), texts: z.array(z.string().min(1).max(2000)).min(1).max(32) }).parse(d))
  .handler(async ({ data, context }): Promise<{ key: string; vectors: number[][] } | { error: AiProblem }> => {
    sameSession(data.expectedAtlasUserId, context.userId);
    try {
      const ai = await (await store()).embeddingModel(context.userId);
      if ('problem' in ai) return { error: ai.problem };
      const { embedWith, EMBEDDING_MODELS } = await import('./intelligence/embeddings');
      const m = EMBEDDING_MODELS[ai.credential.provider];
      if (!m) return { error: 'bad-model' };
      let vectors: Float32Array[];
      try { vectors = await embedWith(ai.credential, data.texts, data.kind); } catch (e) { (await store()).noteEmbedding(ai.keyId, e); throw e; }
      (await store()).noteEmbedding(ai.keyId, null);
      return { key: m.key, vectors: vectors.map(v => Array.from(v)) };
    } catch (e) {
      return { error: (await store()).problem(e) };
    }
  });

/** Other searches meaning the same as `q`, from the person's server-kept model (post search with Intelligence on). */
export const searchWordingsFor = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth])
  .inputValidator(d => z.object({ expectedAtlasUserId: Uid, q: z.string().trim().min(2).max(200) }).parse(d))
  .handler(async ({ data, context }): Promise<{ terms: string[] } | { error: AiProblem }> => {
    sameSession(data.expectedAtlasUserId, context.userId);
    try {
      const { searchWordings } = await import('./intelligence/tasks');
      const r = await (await store()).withAi(context.userId, 'main', (c, model) => searchWordings(c, model, data.q));
      return 'problem' in r ? { error: r.problem } : { terms: r.value };
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
      const { writeAltText } = await import('./intelligence/tasks');
      const r = await (await store()).withAi(context.userId, 'main', (c, model) => writeAltText(c, model, data.image, data.text));
      return 'problem' in r ? { error: r.problem } : { alt: r.value };
    } catch (e) {
      return { error: (await store()).problem(e) };
    }
  });
