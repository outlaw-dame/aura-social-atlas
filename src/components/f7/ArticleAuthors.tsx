import { Icon, Link } from 'framework7-react';
import { CREDIT_LABEL, attributionNote } from '@/lib/article-author';
import type { PostArticle } from '@/lib/fedizen-feed';
import { openFediProfile } from '@/lib/fedi-profile';
import { VideoPlayer } from '@/components/social/VideoPlayer';
import { RichLink } from '@/components/social/RichLink';
import { EpisodePlayer } from './EpisodePlayer';

/**
 * Phone: the article a post links to and its verified authors ("More from"), as on desktop. Each author opens their
 * profile inside Atlas; the note says how Atlas verified them.
 */
export function ArticleCard({ article }: { article?: PostArticle }) {
  if (article?.episode) return <EpisodePlayer episode={article.episode} />;
  if (article?.video) return <VideoPlayer video={article.video} />;
  if (!article || !(article.title || article.authors?.length || article.byline)) return null;
  const host = (() => { try { return new URL(article.url).hostname.replace(/^www\./, ''); } catch { return ''; } })();
  const authors = article.authors ?? [];
  return <div className="atlas-article">
    {article.title && <RichLink article={article} kicker={authors[0]?.work === 'episode' ? `Podcast episode · ${article.provider || host}` : undefined} />}
    {authors.map(a => <Link key={a.acct} onClick={() => openFediProfile(a)} className="atlas-article-author" aria-label={`${CREDIT_LABEL[a.work ?? 'article']}: ${a.name} (${a.acct})`}>
      {a.avatar ? <img src={a.avatar} alt="" width={36} height={36} referrerPolicy="no-referrer" loading="lazy" /> : <span className="atlas-activity-initial" aria-hidden="true">{a.name.charAt(0)}</span>}
      <span><small>{CREDIT_LABEL[a.work ?? 'article']}</small><b>{a.name}</b><small>{a.acct}</small></span><Icon ios="f7:chevron_right" md="material:chevron_right" />
    </Link>)}
    {authors.length > 0 && <p className="atlas-article-note">{attributionNote(authors[0])}</p>}
    {!authors.length && article.byline && <p className="atlas-article-note">By {article.byline}</p>}
  </div>;
}
