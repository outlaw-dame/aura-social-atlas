import { Hash } from 'lucide-react';
import type { FeaturedTag } from '@/lib/fedi-profile';
import { TagText, hashtagLabel } from '@/lib/hashtags';
import { featuredDetail } from '@/lib/featured-tags';

/**
 * Desktop: the hashtags someone features, as Mastodon 4.6 profiles show them — a row of tiles, each with how often
 * and when they last used it. Picking one shows their posts with it; picking it again shows all posts.
 */
export function FeaturedTags({ tags, selected, onSelect }: { tags: FeaturedTag[]; selected: string | null; onSelect: (tag: string | null) => void }) {
  if (!tags.length) return null;
  return <section className="mt-5" aria-label="Featured hashtags">
    <h3 className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"><Hash className="size-3 text-accent" />Featured hashtags</h3>
    <ul className="mt-2 flex flex-wrap gap-2">
      {tags.map(t => {
        const on = selected?.toLowerCase() === t.name.toLowerCase();
        const detail = featuredDetail(t);
        return <li key={t.name}>
          <button type="button" aria-pressed={on} aria-label={`${hashtagLabel(t.name)}${detail ? `, ${detail}` : ''}${on ? ', showing posts with it' : ''}`}
            onClick={() => onSelect(on ? null : t.name)}
            className={`group flex min-w-24 flex-col items-start rounded-2xl border px-3.5 py-2 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${on
              ? 'border-transparent bg-accent text-accent-foreground shadow-sm'
              : 'border-border bg-card hover:border-accent/50 hover:bg-accent/5'}`}>
            <span className="font-serif text-lg italic leading-tight"><TagText tag={t.name} /></span>
            {detail && <span className={`mt-0.5 text-[11px] ${on ? 'text-accent-foreground/80' : 'text-muted-foreground'}`}>{detail}</span>}
          </button>
        </li>;
      })}
    </ul>
  </section>;
}
