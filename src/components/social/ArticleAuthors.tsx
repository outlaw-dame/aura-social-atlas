import { useState } from 'react';
import { ArrowUpRight, BadgeCheck, ChevronRight, Globe2 } from 'lucide-react';
import { CREDIT_LABEL, attributionNote, type FediAuthor } from '@/lib/article-author';
import type { PostArticle } from '@/lib/fedizen-feed';
import { openFediProfile } from '@/lib/fedi-profile';
import { VideoPlayer } from './VideoPlayer';
import { EpisodePlayer } from './EpisodePlayer';
import { RichLink } from './RichLink';

function AuthorAvatar({ a }: { a: FediAuthor }) {
  const [broken, setBroken] = useState(false);
  if (a.avatar && !broken) return <img src={a.avatar} alt="" width={44} height={44} referrerPolicy="no-referrer" loading="lazy" onError={() => setBroken(true)} className="size-11 shrink-0 atlas-avatar object-cover ring-1 ring-border" />;
  return <span aria-hidden="true" className="atlas-avatar flex size-11 shrink-0 items-center justify-center bg-background font-serif text-lg ring-1 ring-border">{a.name.charAt(0)}</span>;
}

/**
 * Mastodon-style "More from" author cards, improved: every credited author (Mastodon shows one), ActivityPub-native
 * articles included, and a note on how the authorship was verified. With no verified author, the publisher's plain
 * byline, if any, unlinked unless a URL is given.
 */
export function AuthorCards({ authors, byline, bylineUrl, className = 'mt-4' }: { authors?: FediAuthor[]; byline?: string; bylineUrl?: string; className?: string }) {
  if (authors?.length) return <div className={`${className} space-y-2`}>
    {authors.map(a => <button type="button" key={a.acct} onClick={() => openFediProfile(a)} className="group/by flex w-full items-center gap-3 rounded-2xl border border-border/60 bg-muted/40 p-3 text-left shadow-sm transition-colors hover:bg-muted" aria-label={`${CREDIT_LABEL[a.work ?? 'article']}: ${a.name} (${a.acct})`}>
      <AuthorAvatar a={a} />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"><Globe2 className="size-3" aria-hidden="true" />{CREDIT_LABEL[a.work ?? 'article']}</span>
        <span className="mt-0.5 block truncate text-sm font-semibold text-foreground">{a.name}</span>
        <span className="block truncate text-xs text-muted-foreground">{a.acct}</span>
      </span>
      <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover/by:translate-x-0.5" aria-hidden="true" />
    </button>)}
    <p className="flex items-center gap-1 text-[11px] text-muted-foreground"><BadgeCheck className="size-3 shrink-0" aria-hidden="true" />{attributionNote(authors[0])}</p>
  </div>;
  if (!byline) return null;
  return <p className="mt-2 text-xs text-muted-foreground">By {bylineUrl ? <a href={bylineUrl} target="_blank" rel="noopener noreferrer" className="hover:underline">{byline}</a> : byline}</p>;
}

/** The article a feed post links to, and who wrote it. */
export function PostArticleCard({ article }: { article?: PostArticle }) {
  if (!article) return null;
  // An episode plays in place; its podcast row is the creator tag.
  if (article.episode) return <EpisodePlayer episode={article.episode} />;
  // A video (PeerTube, a video episode) plays in place; its channel row is the creator tag.
  if (article.video) return <VideoPlayer video={article.video} />;
  const host = (() => { try { return new URL(article.url).hostname.replace(/^www\./, ''); } catch { return ''; } })();
  const showLink = !!(article.title || article.authors?.length || article.byline);
  if (!showLink) return null;
  return <div className="mt-3">
    {article.title && <RichLink article={article} kicker={article.authors?.[0]?.work === 'episode' ? `Podcast episode · ${article.provider || host}` : undefined} />}
    {/* With a preview, its card carries the creators; these are for a credit without one. */}
    {!article.title && <AuthorCards authors={article.authors} byline={article.byline} className="mt-2" />}
  </div>;
}
