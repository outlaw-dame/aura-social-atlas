import { z } from 'zod';
import { htmlToParagraphs } from './spotlight';
import { requestBonfireGraphQL, type BonfireGraphQLRequest } from './bonfire-graphql.server';
import {
  NATIVE_POST_BY_ID_DOCUMENT,
  NATIVE_PROFILE_BY_ID_DOCUMENT,
  NATIVE_PROFILE_BY_USERNAME_DOCUMENT,
} from './bonfire/graphql/operations';

/**
 * Read-only Bonfire detail projections selected from the effective Fedizen
 * schema, not guessed from the Mastodon API. All callers must be authenticated
 * server functions and must supply the user's own delegated read grant.
 * GraphQL still owns boundary and object-visibility decisions.
 */
type ReadOptions = Pick<BonfireGraphQLRequest<unknown>, 'fetchImpl' | 'waitImpl' | 'signal'>;
const safeID = z.string().min(1).max(320).regex(/^[^\u0000-\u001f\u007f]+$/);
const safeUsername = z.string().min(1).max(320).regex(/^[\p{L}\p{N}_.@-]+$/u);

export const profileSelectorSchema = z.discriminatedUnion('by', [
  z.object({ by: z.literal('id'), value: safeID }),
  z.object({ by: z.literal('username'), value: safeUsername }),
]);
export type ProfileSelector = z.infer<typeof profileSelectorSchema>;

const characterSchema = z.object({
  username: z.string().max(320).nullish(),
  canonicalUri: z.string().max(2048).nullish(),
}).nullable();

const profileSchema = z.object({
  name: z.string().max(320).nullish(),
  summary: z.string().max(65_536).nullish(),
  icon: z.string().max(2048).nullish(),
  image: z.string().max(2048).nullish(),
  website: z.string().max(2048).nullish(),
  location: z.string().max(320).nullish(),
}).nullable();

const userSchema = z.object({
  id: z.string().min(1).max(320),
  character: characterSchema,
  profile: profileSchema,
  followersCount: z.number().int().nonnegative().nullish(),
  followingCount: z.number().int().nonnegative().nullish(),
  statusesCount: z.number().int().nonnegative().nullish(),
});
const userEnvelope = z.object({ user: userSchema.nullable() });
export type NativeBonfireProfile = z.infer<typeof userSchema>;

export async function readNativeBonfireProfile(
  token: string,
  selector: ProfileSelector,
  options: ReadOptions = {},
): Promise<NativeBonfireProfile | null> {
  const valid = profileSelectorSchema.parse(selector);
  return requestBonfireGraphQL({
    ...options,
    operation: 'query',
    document: valid.by === 'id' ? NATIVE_PROFILE_BY_ID_DOCUMENT : NATIVE_PROFILE_BY_USERNAME_DOCUMENT,
    variables: { [valid.by === 'id' ? 'id' : 'username']: valid.value },
    accessToken: token,
    validate: data => userEnvelope.parse(data).user,
  });
}

const postSchema = z.object({
  id: z.string().min(1).max(320),
  postContent: z.object({
    name: z.string().max(8192).nullish(),
    summary: z.string().max(65_536).nullish(),
    htmlBody: z.string().max(256_000).nullish(),
  }).nullable(),
  creator: z.object({
    // AnyCharacter also includes non-User implementations. A User-only
    // fragment legitimately yields an empty object for those variants.
    character: characterSchema.optional(),
    profile: z.object({
      name: z.string().max(320).nullish(),
      icon: z.string().max(2048).nullish(),
    }).nullable().optional(),
  }).nullable(),
  activity: z.object({
    id: z.string().min(1).max(320),
    date: z.string().max(80).nullish(),
    canonicalUri: z.string().max(2048).nullish(),
    repliesCount: z.number().int().nonnegative().nullish(),
    likeCount: z.number().int().nonnegative().nullish(),
    boostCount: z.number().int().nonnegative().nullish(),
    likedByMe: z.boolean().nullish(),
    boostedByMe: z.boolean().nullish(),
    bookmarkedByMe: z.boolean().nullish(),
  }).nullable(),
});
const postEnvelope = z.object({ post: postSchema.nullable() });
type NativeBonfirePostRaw = z.infer<typeof postSchema>;

export type NativeBonfirePostDetail = {
  id: string;
  title: string | null;
  summary: string | null;
  paragraphs: string[];
  creator: { name: string | null; username: string | null; icon: string | null } | null;
  activity: NativeBonfirePostRaw['activity'];
};

/** Remove remote HTML before passing post detail to Atlas presentation. */
export function normalizeNativeBonfirePost(raw: NativeBonfirePostRaw | null): NativeBonfirePostDetail | null {
  if (!raw) return null;
  return {
    id: raw.id,
    title: raw.postContent?.name ?? null,
    summary: raw.postContent?.summary ?? null,
    paragraphs: htmlToParagraphs(raw.postContent?.htmlBody ?? ''),
    creator: raw.creator ? {
      name: raw.creator.profile?.name ?? null,
      username: raw.creator.character?.username ?? null,
      icon: raw.creator.profile?.icon ?? null,
    } : null,
    activity: raw.activity,
  };
}

export async function readNativeBonfirePost(
  token: string,
  id: string,
  options: ReadOptions = {},
): Promise<NativeBonfirePostDetail | null> {
  const validId = safeID.parse(id);
  return requestBonfireGraphQL({
    ...options,
    operation: 'query',
    document: NATIVE_POST_BY_ID_DOCUMENT,
    variables: { id: validId },
    accessToken: token,
    validate: data => normalizeNativeBonfirePost(postEnvelope.parse(data).post),
  });
}
