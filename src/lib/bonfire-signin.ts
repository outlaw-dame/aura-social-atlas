import { BONFIRE_PROVIDER, BONFIRE_SCOPES, friendlyBonfireError } from './bonfire-auth';

/**
 * Start a browser OIDC login without leaking SDK/runtime exception details.
 * An unavailable identity provider is not an authenticated session.
 * The caller must restore its busy state on both rejection and completion.
 */
export async function beginBonfireSignIn(
  origin: string,
  signInWithOAuth: (options: {
    provider: typeof BONFIRE_PROVIDER;
    options: { redirectTo: string; scopes: typeof BONFIRE_SCOPES };
  }) => Promise<{ error: { message: string } | null }>,
): Promise<string | null> {
  try {
    const { error } = await signInWithOAuth({
      provider: BONFIRE_PROVIDER,
      options: { redirectTo: origin, scopes: BONFIRE_SCOPES },
    });
    return error ? friendlyBonfireError(error.message) : null;
  } catch {
    // Do not return raw exception messages: network and identity runtimes
    // can include tokens, callback URLs, or provider implementation details.
    return 'Couldn’t start Bonfire sign-in. Please try again.';
  }
}
