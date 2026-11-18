import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { requireSupabaseAuth } from '@/integrations/supabase/auth-middleware';
import { API_KEY } from './intelligence/providers';
import type { DeeplProblem } from './translation/deepl.server';

/**
 * Translation through the person's own services (lib/translation). On-device translation never reaches these.
 * - DeepL: the key is checked with DeepL (its usage), then kept encrypted in Atlas's key vault, shown again only as its
 *   last four characters, and sent nowhere but DeepL.
 * - The person's AI provider (Intelligence) translates through intelligence.functions.ts' key and settings.
 * The browser sends only posts that may leave the device (public or unlisted; lib/translation/plan.ts decides).
 */
export type TranslateProblem = DeeplProblem | 'not-configured' | 'no-key' | 'storage';
export type TranslationKeys = { serverKeys: boolean; deepl: { hint: string; plan: 'free' | 'pro'; used?: number; limit?: number } | null };

const Uid = z.string().uuid();
const DEEPL_KEY = z.string().trim().regex(API_KEY);
const TAG = z.string().regex(/^[A-Za-z]{2,3}(-[A-Za-z]{2,4})?$/);
/** One request: at most 50 texts and 100,000 characters (DeepL takes 128 KiB). */
const Texts = z.array(z.string().max(20_000)).min(1).max(50).refine(t => t.reduce((n, x) => n + x.length, 0) <= 100_000, 'too-long');

function sameSession(expected: string, actual: string) {
  if (expected !== actual) throw new Error('Atlas session changed. Sign in again before continuing.');
}

async function problemOf(e: unknown): Promise<TranslateProblem> {
  const { DeeplError } = await import('./translation/deepl.server');
  const { VaultError } = await import('./intelligence/vault.server');
  if (e instanceof DeeplError) return e.code;
  if (e instanceof VaultError) return e.code === 'unreadable' ? 'bad-key' : e.code;
  return 'unavailable';
}

/** Which translation keys the person has, with DeepL's usage for the period when DeepL answers. */
export const getTranslationKeys = createServerFn({ method: 'GET' }).middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<TranslationKeys> => {
    const { vaultReady, serviceKey } = await import('./intelligence/vault.server');
    const serverKeys = await vaultReady().catch(() => false);
    if (!serverKeys) return { serverKeys, deepl: null };
    try {
      const k = await serviceKey(context.userId, 'deepl');
      if (!k) return { serverKeys, deepl: null };
      const { deeplPlan, deeplUsage } = await import('./translation/deepl.server');
      const usage = await deeplUsage(k.key).catch(() => null);
      return { serverKeys, deepl: { hint: k.hint, plan: deeplPlan(k.key), ...(usage ? { used: usage.used, limit: usage.limit } : {}) } };
    } catch {
      return { serverKeys, deepl: null };
    }
  });

/** Checks a DeepL key with DeepL, then keeps it. */
export const saveDeeplKey = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth])
  .inputValidator(d => z.object({ expectedAtlasUserId: Uid, key: DEEPL_KEY }).parse(d))
  .handler(async ({ data, context }): Promise<{ ok: true } | { error: TranslateProblem }> => {
    sameSession(data.expectedAtlasUserId, context.userId);
    try {
      const { vaultReady, storeCredential } = await import('./intelligence/vault.server');
      if (!(await vaultReady())) return { error: 'not-configured' };
      const { deeplUsage } = await import('./translation/deepl.server');
      await deeplUsage(data.key);
      const { keyHint } = await import('./intelligence/providers');
      await storeCredential(context.userId, { provider: 'deepl', key: data.key }, keyHint(data.key), []);
      return { ok: true };
    } catch (e) {
      return { error: await problemOf(e) };
    }
  });

export const removeDeeplKey = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth])
  .inputValidator(d => z.object({ expectedAtlasUserId: Uid }).parse(d))
  .handler(async ({ data, context }): Promise<{ ok: true } | { error: TranslateProblem }> => {
    sameSession(data.expectedAtlasUserId, context.userId);
    try {
      const { forgetCredential } = await import('./intelligence/vault.server');
      await forgetCredential(context.userId, 'deepl');
      return { ok: true };
    } catch (e) {
      return { error: await problemOf(e) };
    }
  });

/** Translates texts with the person's DeepL key. */
export const translateWithDeepl = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth])
  .inputValidator(d => z.object({ expectedAtlasUserId: Uid, texts: Texts, target: z.string().regex(/^[A-Z]{2}(-[A-Z]{2,4})?$/), source: z.string().regex(/^[A-Z]{2}$/).optional() }).parse(d))
  .handler(async ({ data, context }): Promise<{ texts: string[]; detected?: string } | { error: TranslateProblem }> => {
    sameSession(data.expectedAtlasUserId, context.userId);
    try {
      const { serviceKey } = await import('./intelligence/vault.server');
      const k = await serviceKey(context.userId, 'deepl');
      if (!k) return { error: 'no-key' };
      const { deeplTranslate } = await import('./translation/deepl.server');
      return await deeplTranslate(k.key, { texts: data.texts, target: data.target, ...(data.source ? { source: data.source } : {}) });
    } catch (e) {
      return { error: await problemOf(e) };
    }
  });

/** Translates texts with the person's AI provider (Intelligence must be on, with a key on Atlas's server). */
export const translateWithAi = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth])
  .inputValidator(d => z.object({ expectedAtlasUserId: Uid, texts: Texts, target: TAG, source: TAG.optional() }).parse(d))
  .handler(async ({ data, context }): Promise<{ texts: string[]; detected?: string } | { error: TranslateProblem }> => {
    sameSession(data.expectedAtlasUserId, context.userId);
    try {
      const store = await import('./intelligence/store.server');
      const ai = await store.activeModel(context.userId);
      if ('problem' in ai) return { error: ai.problem === 'not-ready' ? 'no-key' : 'unavailable' };
      const { translateTexts } = await import('./intelligence/tasks');
      return await translateTexts(ai.credential, ai.model, { texts: data.texts, target: data.target, ...(data.source ? { source: data.source } : {}) });
    } catch (e) {
      return { error: await problemOf(e) };
    }
  });
