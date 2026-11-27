import { z } from 'zod';
import { fromBonfirePosts, type BonfireActivityNode } from './spotlight';
import { boostFields, isPlaceholderAvatar, type FediPerson, type FedizenPost } from './fedizen-feed';
import { BonfireGraphQLError, requestBonfireGraphQL, type BonfireGraphQLRequest } from './bonfire-graphql.server';
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

/**
 * A network/GraphQL parser failure is NOT proof of authorization enforcement.
 * Only an explicitly empty Me identity or HTTP unauthorized/forbidden response
 * can satisfy the anonymous-access acceptance check.
 */
export function isConclusiveAnonymousMeDenial(
  identity: NativeBonfireIdentity | undefined,
  error?: unknown,
): boolean {
  if (error !== undefined) {
    return error instanceof BonfireGraphQLError &&
      error.kind === 'http' && (error.status === 401 || error.status === 403);
  }
  return identity === null || identity?.user === null;
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

/** Reads one post as the REST feeds show it (Mastodon `GET /api/v1/statuses/:id`, normalized by fromStatuses). */
export type NativeStatusRead = (statusId: string) => Promise<FedizenPost | undefined>;

const STATUS_ID = /^[A-Za-z0-9_-]{1,64}$/;
const http = (u?: string | null) => (u && /^https?:\/\//i.test(u) ? u : undefined);

/** The person who boosted, as GraphQL names them (the activity's own subject, before the boost credits the author). */
function boosterOf(node: BonfireActivityNode): FediPerson | undefined {
  const s = node.subject;
  const user = s?.character?.username?.replace(/^@/, '');
  const name = s?.profile?.name || user;
  if (!name) return undefined;
  const avatar = http(s?.profile?.icon);
  const actor = s?.character?.canonicalUri;
  return {
    name,
    ...(avatar && !isPlaceholderAvatar(avatar) ? { avatar } : {}),
    ...(user ? { acct: user.includes('@') ? user : `${user}@fedizen.net` } : {}),
    ...(actor && /^https:\/\//i.test(actor) ? { actor } : {}),
  };
}

/**
 * Native Home with the same cards as the REST feed. GraphQL decides which posts are on the page, their order and the
 * next cursor; each post's details come from its REST status (the GraphQL post id is the status id), because
 * Bonfire rc.1's GraphQL doesn't carry visibility, language, mentions, polls, link cards, video or quotes. A boost
 * keeps the booster GraphQL names. A post whose read fails, isn't back within the budget, or has no usable id stays
 * the GraphQL-only card, which offers Share only, so no button claims a state Atlas doesn't know.
 */
/**
 * Reads statuses `concurrency` at a time until `budgetMs` runs out; reads not started by then aren't sent. Unsafe ids
 * are never read. Returns what came back, by status id.
 */
export async function readStatuses(
  ids: readonly string[],
  read: NativeStatusRead,
  budgetMs: number,
  concurrency = 8,
): Promise<Map<string, FedizenPost>> {
  const todo = [...new Set(ids)].filter(id => STATUS_ID.test(id));
  const found = new Map<string, FedizenPost>();
  let next = 0;
  let stopped = false;
  const worker = async () => {
    while (!stopped && next < todo.length) {
      const id = todo[next++];
      const post = await read(id).catch(() => undefined);
      if (post && !stopped) found.set(id, post);
    }
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([
    Promise.all(Array.from({ length: Math.min(concurrency, todo.length) }, worker)),
    new Promise(resolve => { timer = setTimeout(resolve, budgetMs); }),
  ]);
  stopped = true; // Reads not started by the deadline aren't sent; one finishing late isn't used.
  if (timer) clearTimeout(timer);
  return found;
}

/** One entry per post, as fromBonfirePosts counts them (a boost and its original are the same post). */
function distinctNodes(nodes: readonly BonfireActivityNode[]): BonfireActivityNode[] {
  const seen = new Set<string>();
  return nodes.filter(n => {
    const key = n.object?.id ?? n.id;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

const isBoost = (node: BonfireActivityNode) => node.verb?.verb === 'Boost' || node.verb?.verb === 'Announce';

/**
 * The GraphQL-only card: what GraphQL can show (no actions: Atlas doesn't know the reader's state), with who boosted
 * it and, when it has a usable one, the status id to read its details from afterwards (getNativeHomeDetails).
 */
export function nativeOnlyCard(node: BonfireActivityNode): FedizenPost[] {
  return fromBonfirePosts([node]).map(card => {
    const statusId = node.object?.id;
    const booster = isBoost(node) ? boosterOf(node) : undefined;
    return {
      ...card,
      ...(statusId && STATUS_ID.test(statusId) ? { statusRef: statusId } : {}),
      ...boostFields(booster),
    };
  });
}

/** A post's REST card in place of its GraphQL-only one: the GraphQL id and booster stay. */
export function withRestDetails(native: Pick<FedizenPost, 'id' | 'boostedBy' | 'booster' | 'relayed'>, rest: FedizenPost): FedizenPost {
  const { statusRef: _drop, ...card } = rest;
  return {
    ...card,
    id: native.id,
    ...(native.relayed ? { relayed: native.relayed } : boostFields(native.booster, native.boostedBy)),
  };
}

/**
 * Native Home with the same cards as the REST feed. GraphQL decides which posts are on the page, their order and the
 * next cursor; each post's details come from its REST status (the GraphQL post id is the status id), because
 * Bonfire rc.1's GraphQL doesn't carry visibility, language, mentions, polls, link cards, video or quotes. A boost
 * keeps the booster GraphQL names. A post not read within the budget stays the GraphQL-only card (Share only) with
 * its statusRef, so the browser can ask for its details right after (getNativeHomeDetails) without holding up the
 * page.
 */
export async function hydrateNativeBonfireHome(
  page: NativeBonfirePage,
  read: NativeStatusRead,
  budgetMs = 2500,
  concurrency = 8,
): Promise<FedizenPost[]> {
  const nodes = distinctNodes(page.nodes);
  const found = await readStatuses(nodes.flatMap(n => (n.object?.id ? [n.object.id] : [])), read, budgetMs, concurrency);
  return nodes.flatMap((node): FedizenPost[] => {
    const rest = node.object?.id ? found.get(node.object.id) : undefined;
    const booster = isBoost(node) ? boosterOf(node) : undefined;
    return rest ? [withRestDetails({ id: node.id, ...boostFields(booster) }, rest)] : nativeOnlyCard(node);
  });
}

/** The first page of native Home as GraphQL-only cards, for spotting new posts without reading each one. */
export function nativeLatestPreview(page: NativeBonfirePage): FedizenPost[] {
  return distinctNodes(page.nodes).flatMap(nativeOnlyCard);
}
