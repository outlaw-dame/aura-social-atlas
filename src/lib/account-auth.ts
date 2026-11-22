/**
 * Keep email/password authentication responsive when the identity SDK throws
 * instead of returning an AuthError (for example, during network failure).
 * Never surface raw exception text: it can contain callback URLs or tokens.
 */
export type AccountAuthResult<T> =
  | { kind: 'success'; data: T }
  | { kind: 'error'; message: string };

export async function runAccountAuth<T>(
  request: () => Promise<{ data: T; error: { message: string } | null }>,
): Promise<AccountAuthResult<T>> {
  try {
    const { data, error } = await request();
    if (error) return { kind: 'error', message: error.message };
    return { kind: 'success', data };
  } catch {
    return { kind: 'error', message: 'Could not reach the sign-in service. Please try again.' };
  }
}
