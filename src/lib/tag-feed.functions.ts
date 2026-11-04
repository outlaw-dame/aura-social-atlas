import { createServerFn } from '@tanstack/react-start';
import { htmlToParagraphs } from './spotlight';

export type TagPost = {
  id: string; url: string; createdAt: string; text: string[];
  author: { name: string; acct: string; avatar: string; url: string };
  image?: string; replies: number; boosts: number; favourites: number;
};

type Status = {
  id: string; url: string | null; uri: string; created_at: string; content: string; spoiler_text: string; sensitive: boolean;
  replies_count: number; reblogs_count: number; favourites_count: number;
  account: { display_name: string; username: string; acct: string; avatar: string; url: string };
  media_attachments: { type: string; preview_url: string | null }[];
};

/** Mastodon hashtag timeline: public posts known to the server that used the tag. */
export const getTagFeed = createServerFn({ method: 'GET' })
  .inputValidator((d: { tag: string }) => {
    const tag = String(d?.tag ?? '').replace(/^#/, '');
    if (!/^[\p{L}\p{N}_]{1,100}$/u.test(tag)) throw new Error('Invalid hashtag');
    return { tag };
  })
  .handler(async ({ data }): Promise<TagPost[]> => {
    const res = await fetch(`https://mastodon.social/api/v1/timelines/tag/${encodeURIComponent(data.tag)}?limit=30`, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error('The hashtag feed is unavailable right now.');
    const list = await res.json() as Status[];
    return list.map(s => {
      const acct = s.account.acct.includes('@') ? s.account.acct : `${s.account.acct}@mastodon.social`;
      const img = !s.sensitive ? s.media_attachments.find(m => m.type === 'image' && m.preview_url)?.preview_url ?? undefined : undefined;
      return {
        id: s.id, url: s.url ?? s.uri, createdAt: s.created_at,
        text: s.spoiler_text ? [`Content warning: ${s.spoiler_text}`] : htmlToParagraphs(s.content),
        author: { name: s.account.display_name || s.account.username, acct: `@${acct}`, avatar: s.account.avatar, url: s.account.url },
        image: img, replies: s.replies_count, boosts: s.reblogs_count, favourites: s.favourites_count,
      };
    });
  });
