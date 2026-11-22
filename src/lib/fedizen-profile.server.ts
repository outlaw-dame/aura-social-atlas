import { z } from 'zod';
import { requestBonfireGraphQL } from './bonfire-graphql.server';
import { MY_PROFILE_DOCUMENT, UPDATE_MY_PROFILE_DOCUMENT } from './bonfire/graphql/operations';
import { fromBonfireProfile, type FedizenProfile } from './fedizen-profile';

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
