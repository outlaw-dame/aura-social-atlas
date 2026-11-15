import { useState } from 'react';
import { ArrowUpRight, BadgeCheck, ChevronRight, Globe2 } from 'lucide-react';
import { ATTRIBUTION_NOTE, type FediAuthor } from '@/lib/article-author';
import type { PostArticle } from '@/lib/fedizen-feed';

function AuthorAvatar({ a }: { a: FediAuthor }) {
  const [broken, setBroken] = useState(false);
  if (a.avatar && !broken) return <img src={a.avatar} alt="" width={44} height={44} referrerPolicy="no-referrer" loading="lazy" onError={() => setBroken(true)} className="size-11 shrink-0 rounded-xl object-cover ring-1 ring-border" />;
  return <span aria-hidden="true" className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-background font-serif text-lg ring-1 ring-border">{a.name.charAt(0)}</span>;
}

/**
 * Mastodon-style "More from" author cards, improved: every credited author (Mastodon shows one), ActivityPub-native
 * articles included, and a note on how the authorship was verified. With no verified author, the publisher's plain
 * byline, if any, unlinked unless a URL is given.
 */
export function AuthorCards({ authors, byline, bylineUrl, className = 'mt-4' }: { authors?: FediAuthor[]; byline?: string; bylineUrl?: string; className?: string }) {
  if (authors?.length) return <div className={`${className} space-y-2`}>
    {authors.map(a => <a key={a.acct} href={a.url} target="_blank" rel="noopener noreferrer" className="group/by flex items-center gap-3 rounded-2xl border border-border/60 bg-muted/40 p-3 shadow-sm transition-colors hover:bg-muted" aria-label={`More from ${a.name} (${a.acct}) on the fediverse`}>
      <AuthorAvatar a={a} />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"><Globe2 className="size-3" aria-hidden="true" />More from</span>
        <span className="mt-0.5 block truncate text-sm font-semibold text-foreground">{a.name}</span>
        <span className="block truncate text-xs text-muted-foreground">{a.acct}</span>
      </span>
      <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover/by:translate-x-0.5" aria-hidden="true" />
    </a>)}
    <p className="flex items-center gap-1 text-[11px] text-muted-foreground"><BadgeCheck className="size-3 shrink-0" aria-hidden="true" />{ATTRIBUTION_NOTE[authors[0].verifiedBy]}</p>
  </div>;
  if (!byline) return null;
  return <p className="mt-2 text-xs text-muted-foreground">By {bylineUrl ? <a href={bylineUrl} target="_blank" rel="noopener noreferrer" className="hover:underline">{byline}</a> : byline}</p>;
}

/** The article a feed post links to, and who wrote it. */
export function PostArticleCard({ article }: { article?: PostArticle }) {
  if (!article) return null;
  const host = (() => { try { return new URL(article.url).hostname.replace(/^www\./, ''); } catch { return ''; } })();
  const showLink = !!(article.title || article.authors?.length || article.byline);
  if (!showLink) return null;
  return <div className="mt-3">
    {article.title && <a href={article.url} target="_blank" rel="noopener noreferrer" className="flex items-start gap-2 rounded-2xl border border-border p-3 transition-colors hover:bg-secondary/60">
      <span className="min-w-0 flex-1">
        <span className="block text-[11px] text-muted-foreground">{article.provider || host}</span>
        <span className="mt-0.5 line-clamp-2 block text-sm font-semibold">{article.title}</span>
      </span>
      <ArrowUpRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
    </a>}
    <AuthorCards authors={article.authors} byline={article.byline} className="mt-2" />
  </div>;
}
