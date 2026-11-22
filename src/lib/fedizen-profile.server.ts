import { z } from 'zod';
import { requestBonfireGraphQL } from './bonfire-graphql.server';
import { MY_PROFILE_DOCUMENT, UPDATE_MY_PROFILE_DOCUMENT, UPDATE_MY_PROFILE_IMAGES_DOCUMENT } from './bonfire/graphql/operations';
import { fromBonfireProfile, profileImageProblem, type FedizenProfile, type ProfileImageKind } from './fedizen-profile';

/** `me.user` / `updateUser.user`: the profile only counts when it is the verified account's own (same user id). */
const userWithProfile = z.object({
  id: z.string().min(1).max(320),
  profile: z.unknown(),
}).nullable();

function ownProfile(user: z.infer<typeof userWithProfile>, expectedUserId: string): FedizenProfile | null {
  return user && user.id === expectedUserId ? fromBonfireProfile(user.profile) : null;
}

export async function readMyFedizenProfile(accessToken: string, expectedUserId: string): Promise<FedizenProfile | null> {
  return requestBonfireGraphQL({
    operation: 'query',
    document: MY_PROFILE_DOCUMENT,
    accessToken,
    validate: data => ownProfile(z.object({ me: z.object({ user: userWithProfile }).nullable() }).parse(data).me?.user ?? null, expectedUserId),
  });
}

/** Sends exactly the four fields Bonfire's `profile_input` takes. Never retried (a mutation). */
export async function updateMyFedizenProfile(accessToken: string, expectedUserId: string, profile: FedizenProfile): Promise<FedizenProfile | null> {
  return requestBonfireGraphQL({
    operation: 'mutation',
    document: UPDATE_MY_PROFILE_DOCUMENT,
    accessToken,
    variables: { profile: { name: profile.name, summary: profile.bio, website: profile.website, location: profile.location } },
    validate: data => ownProfile(z.object({ updateUser: z.object({ user: userWithProfile }).nullable() }).parse(data).updateUser?.user ?? null, expectedUserId),
  });
}

const imageUrl = z.string().max(2048).refine(u => /^https:\/\//i.test(u)).nullish().catch(null);

/**
 * Replaces the verified account's profile picture or banner with one image (multipart `updateUser(images:)`; never
 * retried). Answers the new image's address, or null when Bonfire answered for someone else or without it.
 */
export async function updateMyFedizenProfileImage(accessToken: string, expectedUserId: string, kind: ProfileImageKind, file: Blob, name: string): Promise<string | null> {
  if (profileImageProblem(file)) throw new Error('Unsupported profile image.');
  const field = kind === 'avatar' ? 'icon' : 'image';
  return requestBonfireGraphQL({
    operation: 'mutation',
    document: UPDATE_MY_PROFILE_IMAGES_DOCUMENT,
    accessToken,
    variables: { images: { [field]: field } },
    files: { [field]: { blob: file, name: name.replace(/[^\w.-]+/g, '_').slice(0, 100) || field } },
    validate: data => {
      const user = z.object({ updateUser: z.object({ user: z.object({ id: z.string(), profile: z.object({ icon: imageUrl, image: imageUrl }).nullish() }).nullable() }).nullable() }).parse(data).updateUser?.user;
      if (!user || user.id !== expectedUserId) return null;
      return (kind === 'avatar' ? user.profile?.icon : user.profile?.image) ?? null;
    },
  });
}
