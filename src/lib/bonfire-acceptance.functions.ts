import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { requireSupabaseAuth } from '@/integrations/supabase/auth-middleware';
import { assertFedizenSessionIntent } from './fedizen-feed';
import { fedizenAcceptanceEnabled, type AcceptanceResult } from './bonfire-acceptance.server';

/**
 * Explicit staging-only diagnostic, not a token export or a production feature.
 * The feature gate is checked before any database or external I/O. All checks
 * run under the authenticated Supabase subject, never a supplied user selector.
 */
export const getFedizenNativeAcceptance = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .inputValidator(input => z.object({
    expectedAtlasUserId: z.string().uuid(),
  }).strict().parse(input))
  .handler(async ({ data, context }): Promise<AcceptanceResult | { status: 'disabled'; checks: [] }> => {
    assertFedizenSessionIntent(data.expectedAtlasUserId, context.userId);
    if (!fedizenAcceptanceEnabled(process.env['ATLAS_FEDIZEN_ACCEPTANCE_PROBES'])) {
      return { status: 'disabled', checks: [] };
    }

    try {
      const { probeAtlasFedizenConnection } = await import('./bonfire-acceptance.server');
      return await probeAtlasFedizenConnection(context.userId);
    } catch {
      return { status: 'failed', checks: [] };
    }
  });

/**
 * Whether this server offers the acceptance page at all. Answers only the gate, without sign-in, so the page can
 * show "not found" on deployments that don't run the diagnostics (the Lovable preview, production).
 */
export const getFedizenAcceptancePageEnabled = createServerFn({ method: 'GET' })
  .handler(async (): Promise<boolean> => fedizenAcceptanceEnabled(process.env['ATLAS_FEDIZEN_ACCEPTANCE_PROBES']));
