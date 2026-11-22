/**
 * Explicit deployment-level auth UX capability flags.
 *
 * Existing Lovable deployments retain their current identity bridge until
 * a separately accepted migration. Independent Atlas deployments use
 * Supabase Auth directly; third-party providers remain hidden unless
 * deliberately enabled and configured for that particular Supabase project.
 *
 * Never infer a credential or provider from hostname, source branch or .env.
 */
export type AtlasAuthRuntime = 'lovable' | 'supabase';
export type AuthUiCapabilities = { runtime: AtlasAuthRuntime; google: boolean; lovable: boolean };

export function authUiCapabilities(
  runtime: string | undefined,
  googleEnabled: string | undefined,
): AuthUiCapabilities {
  // Preserve the existing provider and sessions on legacy deployments.
  // An invalid setting fails closed for third-party sign-in.
  if (runtime === undefined || runtime === 'lovable') {
    return { runtime: 'lovable', google: true, lovable: true };
  }
  if (runtime === 'supabase') {
    return { runtime: 'supabase', google: googleEnabled === 'enabled', lovable: false };
  }
  return { runtime: 'supabase', google: false, lovable: false };
}
