import type { QueryClient } from '@tanstack/react-query';

/**
 * After the reader blocks or mutes someone (or a server), the replies read from other servers in an open conversation
 * (useThread: 'origin-replies') were filtered by the old moderation: drop them and read them again, cancelling any
 * read already on its way so an old answer can't bring them back. Only this reader's; other accounts are unaffected.
 */
export async function revokeOriginReplies(qc: QueryClient, userId: string): Promise<void> {
  const queryKey = ['origin-replies', userId];
  await qc.cancelQueries({ queryKey });
  await qc.resetQueries({ queryKey });
}
