import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { requireSupabaseAuth } from '@/integrations/supabase/auth-middleware';
import { allowedCallback, assertFedizenSessionIntent, hasScope } from './fedizen-feed';

/**
 * Push notifications (src/lib/push/relay.server.ts): whether this Atlas is set up for them, this browser's state, and
 * turning them on or off and choosing what pushes. The relay URL Fedizen pushes to is on the origin the request came
 * from, checked like Fedizen's OAuth callback (allowedCallback), so only Atlas's own deployments can be relays.
 */
const me = z.object({ expectedAtlasUserId: z.string().uuid() });
const B64U = /^[A-Za-z0-9_-]+={0,2}$/;
const device = z.object({ endpoint: z.string().url().max(1024), p256dh: z.string().regex(B64U).max(100), auth: z.string().regex(B64U).max(30) });
const alerts = z.object({ mention: z.boolean(), status: z.boolean(), reblog: z.boolean(), follow: z.boolean(), follow_request: z.boolean(), favourite: z.boolean(), poll: z.boolean(), update: z.boolean(), quote: z.boolean() }).strict();
const policy = z.enum(['all', 'followed', 'follower', 'none']);

/** Whether push is set up and, if not, which secret to fix (never any value); the public key browsers subscribe with. */
export const getPushConfig = createServerFn({ method: 'GET' }).handler(async () => {
  const { vapidConfig, vapidKeysMatch } = await import('./push/relay.server');
  const { b64u } = await import('./push/webpush');
  const v = vapidConfig();
  if ('problem' in v) return { configured: false, publicKey: null, problem: v.problem };
  if (!(await vapidKeysMatch(v))) return { configured: false, publicKey: null, problem: 'keys-do-not-match' as const };
  return { configured: true, publicKey: b64u(v.pub), problem: null };
});

export const getPushState = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth])
  .inputValidator(d => me.extend({ endpoint: z.string().url().max(1024).nullable() }).parse(d))
  .handler(async ({ data, context }) => {
    assertFedizenSessionIntent(data.expectedAtlasUserId, context.userId);
    const { pushState } = await import('./push/relay.server');
    return pushState(context.userId, data.endpoint);
  });

async function relayOrigin(): Promise<string | null> {
  const { getRequest } = await import('@tanstack/react-start/server');
  const origin = getRequest().headers.get('origin');
  const ok = origin ? allowedCallback(origin, origin, process.env['ATLAS_FEDIZEN_CALLBACK_ORIGINS'] ?? '') : null;
  return ok && origin!.startsWith('https://') ? origin : null;
}

export const enablePush = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth])
  .inputValidator(d => me.extend({ device, alerts: alerts.optional(), policy: policy.optional() }).parse(d))
  .handler(async ({ data, context }): Promise<{ ok: true } | { ok: false; error: string }> => {
    assertFedizenSessionIntent(data.expectedAtlasUserId, context.userId);
    const origin = await relayOrigin();
    if (!origin) return { ok: false, error: 'bad-origin' };
    const { tokenFor } = await import('./fedizen.server');
    const t = await tokenFor(context.userId);
    if (!t) return { ok: false, error: 'not-connected' };
    // Bonfire's RequireMastoScope lets `push` or `write` subscribe; Atlas's connection asks for write.
    if (!hasScope(t.scope, 'write')) return { ok: false, error: 'needs-permission' };
    const { addDevice } = await import('./push/relay.server');
    return addDevice(context.userId, t.access_token, origin, data.device, data.alerts && data.policy ? { alerts: data.alerts, policy: data.policy } : undefined);
  });

export const disablePush = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth])
  .inputValidator(d => me.extend({ endpoint: z.string().url().max(1024).nullable() }).parse(d))
  .handler(async ({ data, context }) => {
    assertFedizenSessionIntent(data.expectedAtlasUserId, context.userId);
    const { tokenFor } = await import('./fedizen.server');
    const { removeDevice } = await import('./push/relay.server');
    await removeDevice(context.userId, (await tokenFor(context.userId))?.access_token ?? null, data.endpoint);
    return { ok: true };
  });

export const setPushChoice = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth])
  .inputValidator(d => me.extend({ alerts, policy }).parse(d))
  .handler(async ({ data, context }) => {
    assertFedizenSessionIntent(data.expectedAtlasUserId, context.userId);
    const { tokenFor } = await import('./fedizen.server');
    const t = await tokenFor(context.userId);
    if (!t) return { ok: false };
    const { setChoice } = await import('./push/relay.server');
    return { ok: await setChoice(context.userId, t.access_token, data.alerts, data.policy) };
  });
