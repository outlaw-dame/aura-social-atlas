/**
 * Optional, owner-scoped Bonfire moderation capability.
 *
 * Fedizen's deployed rc.1 does NOT yet implement viewerModeration. The read is
 * OFF by default and is never attempted unless an operator explicitly enables
 * it after deploying and verifying the owner-authorized provider extension.
 *
 * Existing strict REST blocks/mutes remain mandatory. A partial/invalid
 * GraphQL response cannot enable remote Spotlight content.
 */
import { z } from 'zod';
import { requestBonfireGraphQL, type BonfireGraphQLRequest } from './bonfire-graphql.server';
import { matchesLinkedFedizenHandle } from './bonfire-private.server';
import type { SpotlightModeration } from './spotlight-curation';

/** No user ID argument: the provider MUST resolve the OAuth bearer owner. */
export const VIEWER_MODERATION_DOCUMENT = `query AtlasViewerModeration {
  me { user { character { username } } }
  viewerModeration {
    revision complete blockedDomains rejectKeywords warnKeywords
  }
}`;

const rawPolicy = z.object({
  revision: z.string().min(1).max(128).regex(/^[a-zA-Z0-9._:-]+$/),
  complete: z.literal(true),
  blockedDomains: z.array(z.string().min(1).max(253)).max(10_000),
  rejectKeywords: z.array(z.string().min(1).max(200)).max(200),
  warnKeywords: z.array(z.string().min(1).max(200)).max(200),
}).strict();

const responseSchema = z.object({
  me: z.object({
    user: z.object({
      character: z.object({ username: z.string().min(1).max(320) }).strict(),
    }).strict().nullable(),
  }).strict().nullable(),
  viewerModeration: rawPolicy.nullable(),
}).strict();

/** Canonical DNS host (including IDNA): not a URL, wildcard, address or port.
 * Failing the entire snapshot is safer than silently skipping a blocked host.
 */
export function canonicalBlockedDomain(value: string): string | null {
  if (value !== value.trim() || !/^[\p{L}\p{N}.-]+$/u.test(value) ||
      value.endsWith('.') || value.startsWith('.') || value.includes('..')) return null;
  let hostname: string;
  try {
    const origin = new URL(`https://${value}`);
    if (origin.username || origin.password || origin.port || origin.pathname !== '/' ||
        origin.search || origin.hash) return null;
    hostname = origin.hostname.toLowerCase();
  } catch { return null; }
  if (hostname.length > 253 || !hostname.includes('.') ||
      /^\d+\.\d+\.\d+\.\d+$/.test(hostname) ||
      hostname.split('.').some(label => label.length < 1 || label.length > 63 ||
        !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label))) return null;
  return hostname;
}

export type OwnerNativePolicy = {
  revision: string;
  blockedDomains: string[];
  rejectKeywords: string[];
  warnKeywords: string[];
};

/** Validate the entire response; never treat a missing/invalid list as empty. */
export function parseOwnerNativeModeration(data: unknown, expectedHandle: string): OwnerNativePolicy | null {
  const parsed = responseSchema.safeParse(data);
  if (!parsed.success || !parsed.data.me?.user || !parsed.data.viewerModeration ||
      !matchesLinkedFedizenHandle(expectedHandle, parsed.data.me.user.character.username)) return null;
  const policy = parsed.data.viewerModeration;
  const normalized: string[] = [];
  for (const domain of policy.blockedDomains) {
    const canonical = canonicalBlockedDomain(domain);
    if (!canonical) return null;
    normalized.push(canonical);
  }
  return {
    revision: policy.revision,
    blockedDomains: [...new Set(normalized)],
    rejectKeywords: policy.rejectKeywords,
    warnKeywords: policy.warnKeywords,
  };
}

type Options = Pick<BonfireGraphQLRequest<unknown>, 'fetchImpl' | 'waitImpl' | 'signal'>;

/**
 * This opt-in read uses the user's existing delegated Fedizen grant and fixed
 * GraphQL origin, never the server service role. GraphQL errors, 401/403,
 * missing schema fields, malformed objects and mismatched owners return null.
 */
export async function readOwnerNativeModeration(
  token: string, linkedHandle: string, options: Options = {},
  enabled = process.env.ATLAS_BONFIRE_OWNER_MODERATION_READ === 'enabled',
): Promise<OwnerNativePolicy | null> {
  if (!enabled || !token || !linkedHandle) return null;
  // Keep native policy discovery optional in latency as well as correctness.
  // This never holds the local Spotlight view for GraphQL's full retry budget.
  const signal = options.signal
    ? AbortSignal.any([options.signal, AbortSignal.timeout(2500)])
    : AbortSignal.timeout(2500);
  try {
    return await requestBonfireGraphQL({
      ...options,
      signal,
      operation: 'query',
      document: VIEWER_MODERATION_DOCUMENT,
      accessToken: token,
      validate: data => parseOwnerNativeModeration(data, linkedHandle),
    });
  } catch {
    // Deliberately no provider errors, content or identities in logs.
    return null;
  }
}

/** The native keyword matcher and warn/reveal experience are not yet certified
 * against the provider's actual keyword semantics. Never promote remote
 * recommendations while ANY native keyword is configured: dropping that rule
 * would bypass the owner's chosen moderation. Local-source behavior is unchanged.
 */
export function mergeVerifiedOwnerModeration(
  rest: SpotlightModeration | null,
  native: OwnerNativePolicy | null,
): SpotlightModeration | null {
  if (!rest || !native || native.rejectKeywords.length || native.warnKeywords.length) return rest;
  return { ...rest, domainCoverage: 'complete', blockedDomains: native.blockedDomains };
}
