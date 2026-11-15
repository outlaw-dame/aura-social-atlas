import { createServerFn } from '@tanstack/react-start';
import { getRequest } from '@tanstack/react-start/server';
import { z } from 'zod';
import { requireSupabaseAuth } from '@/integrations/supabase/auth-middleware';
import { collectionInput, FEATURE_DENIED_REASON, type Collection } from './collections';

const origin = () => { try { return new URL(getRequest().url).origin; } catch { return undefined; } };
const uuid = z.string().uuid();
const server = () => import('./collections.server');

/** The signed-in person's collections (with pending items). Empty if the collections table isn't there yet. */
export const getMyCollections = createServerFn({ method: 'GET' }).middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ collections: Collection[]; error?: string }> => {
    try { return { collections: await (await server()).listMine(context.userId, origin()) }; }
    catch (e) { console.error(e); return { collections: [], error: 'Collections aren’t available right now.' }; }
  });

/** Opens a collection by its Atlas id, or a shared Mastodon collection link. Public, like Mastodon's. */
export const getCollection = createServerFn({ method: 'GET' })
  .inputValidator(d => z.object({ id: uuid.optional(), link: z.string().url().max(500).optional() }).refine(v => !!v.id !== !!v.link).parse(d))
  .handler(async ({ data }): Promise<Collection | null> => {
    const s = await server();
    try { return data.id ? await s.getOne(data.id, null, origin()) : await s.readMastodonCollection(data.link!); }
    catch (e) { console.error(e); return null; }
  });

/** A Mastodon account's public collections (for its profile). */
export const getAccountCollections = createServerFn({ method: 'GET' })
  .inputValidator(d => z.object({ handle: z.string().min(3).max(320) }).parse(d))
  .handler(async ({ data }) => (await server()).readAccountCollections(data.handle).catch(() => [] as Collection[]));

export const createCollection = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth])
  .inputValidator(d => collectionInput.parse(d))
  .handler(async ({ data, context }) => {
    try { return { id: await (await server()).create(context.userId, data), error: null }; }
    catch (e) { return { id: null, error: e instanceof Error && /up to/.test(e.message) ? e.message : 'Couldn’t create the collection. Try again.' }; }
  });

export const updateCollection = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth])
  .inputValidator(d => z.object({ id: uuid, input: collectionInput }).parse(d))
  .handler(async ({ data, context }) => { await (await server()).update(context.userId, data.id, data.input); return { ok: true }; });

export const deleteCollection = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth])
  .inputValidator(d => z.object({ id: uuid }).parse(d))
  .handler(async ({ data, context }) => { await (await server()).remove(context.userId, data.id); return { ok: true }; });

/** Adds an account after checking, on its own server, that it has opted in to being featured. */
export const addToCollection = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth])
  .inputValidator(d => z.object({ id: uuid, handle: z.string().trim().min(3).max(320) }).parse(d))
  .handler(async ({ data, context }): Promise<{ ok: boolean; message?: string }> => {
    const r = await (await server()).addItem(context.userId, data.id, data.handle);
    return r.ok ? { ok: true } : { ok: false, message: FEATURE_DENIED_REASON[r.reason as keyof typeof FEATURE_DENIED_REASON] ?? r.reason };
  });

export const removeFromCollection = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth])
  .inputValidator(d => z.object({ id: uuid, actorUri: z.string().url().max(2048) }).parse(d))
  .handler(async ({ data, context }) => { await (await server()).removeItem(context.userId, data.id, data.actorUri); return { ok: true }; });
