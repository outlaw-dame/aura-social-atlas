import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { requireSupabaseAuth } from '@/integrations/supabase/auth-middleware';
import { assertFedizenSessionIntent, hasScope } from './fedizen-feed';
import { profileImageProblem, profileInput, type FedizenProfile } from './fedizen-profile';

type Problem = 'disconnected' | 'authorization-required' | 'identity-unverified' | 'needs-permission' | 'rate-limited' | 'rejected' | 'unavailable';
const problemOf = (status: string): Problem =>
  status === 'disconnected' || status === 'authorization-required' || status === 'identity-unverified' ? status : 'unavailable';

/** Bonfire's GraphQL error for a 429 (fedizen-rate-limit.ts), as Atlas tells it apart. */
const isRateLimited = (e: unknown) => !!e && typeof e === 'object' && (e as { kind?: string; status?: number }).kind === 'http' && (e as { status?: number }).status === 429;

/**
 * Your Fedizen profile (name, bio, website, location), read with Bonfire's GraphQL `me` through your own connection,
 * once Atlas has checked that connection is the Fedizen account linked to this Atlas account.
 */
export const getMyFedizenProfile = createServerFn({ method: 'GET' }).middleware([requireSupabaseAuth])
  .inputValidator(d => z.object({ expectedAtlasUserId: z.string().uuid() }).strict().parse(d))
  .handler(async ({ data, context }): Promise<{ profile: FedizenProfile | null; canWrite: boolean; error?: Problem }> => {
    assertFedizenSessionIntent(data.expectedAtlasUserId, context.userId);
    try {
      const [{ verifiedNativeBonfireConnection }, { readMyFedizenProfile }] = await Promise.all([
        import('./bonfire-verified-connection.server'), import('./fedizen-profile.server'),
      ]);
      const c = await verifiedNativeBonfireConnection(data.expectedAtlasUserId, context.userId);
      if (c.status !== 'available') return { profile: null, canWrite: false, error: problemOf(c.status) };
      const profile = await readMyFedizenProfile(c.accessToken, c.identity.user!.id);
      return profile ? { profile, canWrite: hasScope(c.scope, 'write') } : { profile: null, canWrite: false, error: 'unavailable' };
    } catch (e) {
      return { profile: null, canWrite: false, error: isRateLimited(e) ? 'rate-limited' : 'unavailable' };
    }
  });

/**
 * Saves your Fedizen profile with Bonfire's GraphQL `updateUser` (it changes only the signed-in person's own profile
 * and federates the update). Needs a grant that can write. Bonfire links the bio's addresses, mentions and hashtags.
 */
export const saveMyFedizenProfile = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth])
  .inputValidator(d => z.object({ expectedAtlasUserId: z.string().uuid(), profile: profileInput }).strict().parse(d))
  .handler(async ({ data, context }): Promise<{ ok: true; profile: FedizenProfile } | { ok: false; error: Problem }> => {
    assertFedizenSessionIntent(data.expectedAtlasUserId, context.userId);
    try {
      const [{ verifiedNativeBonfireConnection }, { updateMyFedizenProfile }] = await Promise.all([
        import('./bonfire-verified-connection.server'), import('./fedizen-profile.server'),
      ]);
      const c = await verifiedNativeBonfireConnection(data.expectedAtlasUserId, context.userId);
      if (c.status !== 'available') return { ok: false, error: problemOf(c.status) };
      if (!hasScope(c.scope, 'write')) return { ok: false, error: 'needs-permission' };
      const saved = await updateMyFedizenProfile(c.accessToken, c.identity.user!.id, data.profile);
      return saved ? { ok: true, profile: saved } : { ok: false, error: 'rejected' };
    } catch (e) {
      return { ok: false, error: isRateLimited(e) ? 'rate-limited' : (e as { kind?: string })?.kind === 'graphql' ? 'rejected' : 'unavailable' };
    }
  });

/**
 * Replaces your Fedizen profile picture or banner (multipart, relayed to Bonfire's GraphQL `updateUser(images:)`). Type
 * and size are checked again here; Fedizen resizes the image itself.
 */
export const saveMyFedizenProfileImage = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => {
    if (!(d instanceof FormData)) throw new Error('Expected a form.');
    const file = d.get('file');
    if (!(file instanceof Blob)) throw new Error('Expected a file.');
    const parsed = z.object({ expectedAtlasUserId: z.string().uuid(), kind: z.enum(['avatar', 'banner']) }).parse({ expectedAtlasUserId: d.get('expectedAtlasUserId'), kind: d.get('kind') });
    return { ...parsed, file, name: typeof (file as File).name === 'string' ? (file as File).name : parsed.kind };
  })
  .handler(async ({ data, context }): Promise<{ ok: true; url: string | null } | { ok: false; error: Problem | 'unsupported' | 'too-large' }> => {
    assertFedizenSessionIntent(data.expectedAtlasUserId, context.userId);
    const bad = profileImageProblem(data.file);
    if (bad) return { ok: false, error: bad };
    try {
      const [{ verifiedNativeBonfireConnection }, { updateMyFedizenProfileImage }] = await Promise.all([
        import('./bonfire-verified-connection.server'), import('./fedizen-profile.server'),
      ]);
      const c = await verifiedNativeBonfireConnection(data.expectedAtlasUserId, context.userId);
      if (c.status !== 'available') return { ok: false, error: problemOf(c.status) };
      if (!hasScope(c.scope, 'write')) return { ok: false, error: 'needs-permission' };
      const url = await updateMyFedizenProfileImage(c.accessToken, c.identity.user!.id, data.kind, data.file, data.name);
      return { ok: true, url };
    } catch (e) {
      const status = (e as { status?: number })?.status;
      return { ok: false, error: isRateLimited(e) ? 'rate-limited' : status === 413 ? 'too-large' : (e as { kind?: string })?.kind === 'graphql' ? 'rejected' : 'unavailable' };
    }
  });

/**
 * Blocks or unblocks the whole server someone is on, for you, as Mastodon's "Block domain" (server-block.server.ts).
 * Their own address must be on that server; your own server (Fedizen) can't be blocked. The answer is `unconfirmed`
 * when Fedizen took the request without saying whether it worked, which is how it always answers for servers.
 */
export const changeFedizenServerBlock = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth])
  .inputValidator(d => z.object({ expectedAtlasUserId: z.string().uuid(), acct: z.string().regex(/^[^@\s]{1,100}@[a-z0-9.-]{3,253}$/i), on: z.boolean() }).strict().parse(d))
  .handler(async ({ data, context }): Promise<{ ok: true; outcome: 'done' | 'unconfirmed' } | { ok: false; error: Problem | 'own-server' | 'not-found' }> => {
    assertFedizenSessionIntent(data.expectedAtlasUserId, context.userId);
    if (/@fedizen\.net$/i.test(data.acct)) return { ok: false, error: 'own-server' };
    try {
      const [{ verifiedNativeBonfireConnection }, { serverIdFor, changeServerBlock }] = await Promise.all([
        import('./bonfire-verified-connection.server'), import('./server-block.server'),
      ]);
      const c = await verifiedNativeBonfireConnection(data.expectedAtlasUserId, context.userId);
      if (c.status !== 'available') return { ok: false, error: problemOf(c.status) };
      if (!hasScope(c.scope, 'write')) return { ok: false, error: 'needs-permission' };
      const server = await serverIdFor(data.acct);
      if (!server) return { ok: false, error: 'not-found' };
      return { ok: true, outcome: await changeServerBlock(c.accessToken, server, data.on) };
    } catch (e) {
      return { ok: false, error: isRateLimited(e) ? 'rate-limited' : (e as { kind?: string })?.kind === 'graphql' ? 'rejected' : 'unavailable' };
    }
  });
