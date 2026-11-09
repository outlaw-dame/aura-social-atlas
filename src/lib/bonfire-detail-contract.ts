import { z } from 'zod';

/**
 * Browser-safe shape-only validators shared by the typed server reads and
 * TanStack server-function input schemas. No tokens, transport, permissions,
 * or server-only modules may be imported here.
 */
export const bonfireDetailIDSchema = z.string().min(1).max(320)
  .regex(/^[^\u0000-\u001f\u007f]+$/);
export const bonfireUsernameSchema = z.string().min(1).max(320)
  .regex(/^[\p{L}\p{N}_.@-]+$/u);

export const profileSelectorSchema = z.discriminatedUnion('by', [
  z.object({ by: z.literal('id'), value: bonfireDetailIDSchema }),
  z.object({ by: z.literal('username'), value: bonfireUsernameSchema }),
]);
export type ProfileSelector = z.infer<typeof profileSelectorSchema>;
