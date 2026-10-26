// Bonfire (Fedizen.net) sign-in helpers. Browser-safe, no secrets.
// Identity sign-in only: the backend exchanges the code with Fedizen and
// issues an Atlas session. Fedizen API tokens never reach the browser.

/** Lovable Cloud's single custom OIDC provider id (the "custom:" prefix is required). */
export const BONFIRE_PROVIDER = 'custom:app-oidc' as const;
export const BONFIRE_ISSUER = 'https://fedizen.net';
/** Least-privilege scopes for identity: no read/write/admin Bonfire API access. */
export const BONFIRE_SCOPES = 'openid profile email';

export type OAuthError = { code: string; description: string };

/** Reads an OAuth error the auth server appended to the return URL (query or hash). */
export function readOAuthError(href: string): OAuthError | null {
  const url = new URL(href);
  const params = new URLSearchParams(url.search);
  new URLSearchParams(url.hash.replace(/^#/, '')).forEach((v, k) => {
    if (!params.has(k)) params.set(k, v);
  });
  const code = params.get('error_code') || params.get('error');
  if (!code) return null;
  return { code, description: params.get('error_description') || '' };
}

/** Plain-language message for sign-in failures; never echoes tokens. */
export function friendlyBonfireError(message: string): string {
  const m = message.toLowerCase();
  if (m.includes('custom:app-oidc') && m.includes('not found'))
    return 'Bonfire sign-in isn’t switched on yet. The site owner needs to finish setting it up.';
  if (m.includes('unsupported provider'))
    return 'Bonfire sign-in isn’t switched on yet. The site owner needs to finish setting it up.';
  if (m.includes('access_denied') || m.includes('denied'))
    return 'Sign-in was cancelled on Fedizen.';
  if (m.includes('redirect'))
    return 'This address isn’t allowed to finish sign-in. The site owner needs to allow it.';
  return 'Couldn’t sign in with Bonfire. Please try again.';
}

/** Only same-origin relative paths may be used as post-sign-in destinations. */
export function safeNextPath(next: string | null | undefined): string {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.includes('\\')) return '/';
  return next;
}

/**
 * True when the app runs inside an iframe (e.g. the Lovable editor preview).
 * Comparing window references is cross-origin safe; Fedizen's authorization
 * page forbids framing, so an in-frame redirect shows "refused to connect".
 */
export function isEmbeddedPreview(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
}
