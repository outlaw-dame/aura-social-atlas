/** Browser-safe helpers for the standard post actions (reply audience and mention, counts). */
import type { FedizenPost } from './fedizen-feed';

/** The audience a reply goes to: the post's own. A group post read from Fedizen's public feed is public; a post whose
 *  audience Fedizen didn't say is answered unlisted, which is never wider than public. */
export const replyVisibility = (p: Pick<FedizenPost, 'visibility' | 'id'>): NonNullable<FedizenPost['visibility']> =>
  p.visibility ?? (p.id.startsWith('g-') ? 'public' : 'unlisted');

export const AUDIENCE_LABEL: Record<NonNullable<FedizenPost['visibility']>, string> = {
  public: 'Public', unlisted: 'Quiet public', private: 'Followers only', direct: 'Only people mentioned',
};

/** The person's handle starts the reply, as in every Mastodon client. Fedizen's own accounts are written short. */
export const replyMention = (handle: string) => {
  const h = handle.replace(/^@/, '');
  if (!/^[^@\s]+(@[^@\s]+)?$/.test(h)) return '';
  return `@${h.endsWith('@fedizen.net') ? h.slice(0, -'@fedizen.net'.length) : h} `;
};

/** 1234 → "1.2K", as in the app's other counts. */
export const compactCount = (n: number) => (n <= 0 ? '' : new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(n));
