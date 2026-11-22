import { postText, postTags, type FilterAction, type FilterablePost } from '@/lib/content-filter';
import { AI_PROBLEM, DEFAULT_OPTIONS, intelligenceReady, useFilterActions, useIntelligence } from './useIntelligence';

/**
 * "Filter posts like this" (Mastodon has "Filter this post", which hides that one post; Atlas filters its topic).
 * With Intelligence on, the person's AI model names the post's topic as a starting point; without it, the post's first
 * hashtag. Either way the person edits it before anything is added.
 */
export function useFilterLikeThis() {
  const ai = intelligenceReady(useIntelligence().data);
  const act = useFilterActions();
  return {
    /** A first draft of the filter for this post. */
    draft: async (p: FilterablePost): Promise<{ text: string; error?: string }> => {
      const tag = postTags(p)[0];
      if (!ai) return { text: tag ? `#${tag}` : '' };
      const r = await act.describe(postText(p));
      return 'error' in r ? { text: tag ? `#${tag}` : '', error: AI_PROBLEM[r.error] } : { text: r.filter };
    },
    add: (text: string, action: FilterAction) => act.add([text], { ...DEFAULT_OPTIONS, action }),
  };
}
