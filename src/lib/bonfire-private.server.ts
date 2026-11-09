import { z } from 'zod';
import { fromBonfirePosts, type BonfireActivityNode } from './spotlight';
import { requestBonfireGraphQL, type BonfireGraphQLRequest } from './bonfire-graphql.server';
import {
  NATIVE_HOME_DOCUMENT, NATIVE_ME_DOCUMENT, NATIVE_NOTIFICATIONS_DOCUMENT,
  validatedBonfireNodes,
} from './bonfire/graphql/operations';

/**
 * Bonfire-native READ operations observed on Fedizen's deployed schema.
 *
 * These functions do not authenticate callers. Only server functions with
 * verified Atlas auth middleware may retrieve the user-scoped delegated token
 * and call them. No private query is cached or sent to an external endpoint.
 *
 * Disabled from the application UI until consented resource authorization and
 * account mapping are tested against Fedizen.
 */
type RequestOptions = Pick<BonfireGraphQLRequest<unknown>, 'fetchImpl' | 'waitImpl' | 'signal'>;

const identitySchema = z.object({
  me: z.object({
    accountId: z.string().max(320).nullish(),
    user: z.object({
      id: z.string().min(1).max(320),
      character: z.object({
        username: z.string().max(320).nullish(),
        canonicalUri: z.string().max(2048).nullish(),
      }).nullish(),
      profile: z.object({
        name: z.string().max(320).nullish(),
        icon: z.string().max(2048).nullish(),
      }).nullish(),
    }).nullable(),
  }).nullable(),
});

export type NativeBonfireIdentity = z.infer<typeof identitySchema>['me'];

export async function readNativeBonfireMe(
  accessToken: string,
  options: RequestOptions = {},
): Promise<NativeBonfireIdentity> {
  return requestBonfireGraphQL({
    ...options,
    operation: 'query',
    document: NATIVE_ME_DOCUMENT,
    accessToken,
    validate: data => identitySchema.parse(data).me,
  });
}

const pageInfoSchema = z.object({
  endCursor: z.string().max(2048).nullish(),
  startCursor: z.string().max(2048).nullish(),
  hasNextPage: z.boolean(),
  hasPreviousPage: z.boolean(),
});

export type NativeBonfirePage = {
  nodes: BonfireActivityNode[];
  pageInfo: z.infer<typeof pageInfoSchema>;
};

export function validateNativeBonfirePage(data: unknown, field: 'myFeed' | 'notifications'): NativeBonfirePage | null {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('Invalid native GraphQL data');
  }
  const me = (data as Record<string, unknown>).me;
  if (me === null) return null; // The caller does not have an authenticated Bonfire identity.
  if (!me || typeof me !== 'object' || Array.isArray(me)) throw new Error('Invalid Me');
  const value = (me as Record<string, unknown>)[field];
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Missing authorized native Bonfire feed');
  }
  const obj = value as Record<string, unknown>;
  const nodes = validatedBonfireNodes(obj.edges, 20);
  const pageInfo = pageInfoSchema.parse(obj.pageInfo);
  return { nodes, pageInfo };
}

export async function readNativeBonfirePage(
  accessToken: string,
  kind: 'myFeed' | 'notifications',
  after: string | null = null,
  options: RequestOptions = {},
): Promise<NativeBonfirePage | null> {
  if (after !== null && (after.length > 2048 || /[\u0000-\u001f\u007f]/.test(after))) {
    throw new Error('Invalid pagination cursor');
  }
  return requestBonfireGraphQL({
    ...options,
    operation: 'query',
    document: kind === 'myFeed' ? NATIVE_HOME_DOCUMENT : NATIVE_NOTIFICATIONS_DOCUMENT,
    accessToken,
    variables: { first: 20, after },
    validate: data => validateNativeBonfirePage(data, kind),
  });
}

/**
 * A delegated bearer can resolve to an unexpected Bonfire account if an old
 * connection is swapped or an upstream adapter changes identity semantics.
 * Compare the independently obtained REST and GraphQL local names before
 * returning private content. This is a consistency check, not OIDC subject
 * equivalence (which still needs live verification).
 */
export function matchesLinkedFedizenHandle(
  verifiedRestHandle: string | null,
  nativeUsername: string | null | undefined,
): boolean {
  const localName = (value: string | null | undefined): string | null => {
    if (!value || value.length > 320) return null;
    const parts = value.replace(/^@/, '').split('@');
    if (parts.length < 1 || parts.length > 2 || !parts[0] || /[\s/#?]/.test(parts[0])) return null;
    if (parts.length === 2 && parts[1].toLowerCase() !== 'fedizen.net') return null;
    return parts[0].toLowerCase();
  };
  const rest = localName(verifiedRestHandle);
  return rest !== null && rest === localName(nativeUsername);
}

/** Map the native Home read through the same proven post normalizer as public feeds. */
export function normalizeNativeBonfireHome(page: NativeBonfirePage) {
  return {
    posts: fromBonfirePosts(page.nodes),
    pageInfo: page.pageInfo,
  };
}

export type NativeBonfireNotice = {
  id: string;
  verb: string;
  actor: string;
  date?: string;
};

/**
 * Notifications use Activity as their server-authoritative type. Preserve
 * the actual verb rather than assigning speculative Mastodon notification types.
 */
export function normalizeNativeBonfireNotifications(page: NativeBonfirePage): {
  notices: NativeBonfireNotice[];
  pageInfo: NativeBonfirePage['pageInfo'];
} {
  return {
    notices: page.nodes.map(node => ({
      id: node.id,
      verb: typeof node.verb?.verb === 'string' ? node.verb.verb.slice(0, 100) : 'Activity',
      actor: (node.subject?.profile?.name || node.subject?.character?.username || 'Fedizen account').slice(0, 320),
      date: typeof node.date === 'string' ? node.date.slice(0, 80) : undefined,
    })),
    pageInfo: page.pageInfo,
  };
}
