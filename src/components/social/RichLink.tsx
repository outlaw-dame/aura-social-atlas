import { useState } from 'react';
import { BadgeCheck, ChevronRight } from 'lucide-react';
import { CREDIT_LABEL, attributionNote, type FediAuthor } from '@/lib/article-author';
import type { PostArticle } from '@/lib/fedizen-feed';
import { openFediProfile } from '@/lib/fedi-profile';

/** Safe inside url("…"): the characters that could end the string are percent-encoded. */
const cssUrl = (u: string) => u.replace(/["\\\n\r()']/g, c => `%${c.charCodeAt(0).toString(16).padStart(2, '0')}`);
const hostOf = (url: string) => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; } };

function CreatorFace({ a }: { a: FediAuthor }) {
  const [broken, setBroken] = useState(false);
  // People are circles; a podcast or other account shows its square artwork (as across Atlas).
  const shape = a.work === 'podcast' || a.work === 'episode' ? 'is-square' : '';
  return a.avatar && !broken
    ? <img className={`atlas-rich-face ${shape}`} src={a.avatar} alt="" width={36} height={36} referrerPolicy="no-referrer" loading="lazy" onError={() => setBroken(true)} />
    : <span className={`atlas-rich-face ${shape}`} aria-hidden="true">{a.name.charAt(0)}</span>;
}

/**
 * A link preview in the manner of Particle's story cards: the article's image runs edge to edge and fades into a
 * panel tinted by the image itself (a blurred copy, so no colour has to be read from a cross-origin image), with the
 * publisher, the headline and the summary on it. Who made it sits at the foot of the same panel: each verified creator
 * ("More from", opening their profile inside Atlas) with how Atlas verified them, or the publisher's plain byline.
 * Without an image it's the same card in the page's own colours. Phone and desktop share it; `kicker` replaces the
 * publisher line (e.g. "Podcast episode · …").
 */
export function RichLink({ article, kicker }: { article: PostArticle; kicker?: string }) {
  const host = hostOf(article.url);
  const [imageOk, setImageOk] = useState(true);
  const [iconOk, setIconOk] = useState(true);
  const image = article.image && imageOk ? article.image : undefined;
  const authors = article.authors ?? [];
  if (!article.title) return null;
  return <div className={`atlas-rich-link${image ? ' has-image' : ''}`}>
    {image && <span className="atlas-rich-tint" aria-hidden="true" style={{ backgroundImage: `url("${cssUrl(image)}")` }} />}
    <a href={article.url} target="_blank" rel="noopener noreferrer" className="external atlas-rich-main">
      {image && <img className="atlas-rich-image" src={image} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setImageOk(false)} />}
      <span className="atlas-rich-body">
        <span className="atlas-rich-meta">
          {host && iconOk && <img src={`https://${host}/favicon.ico`} alt="" width={16} height={16} loading="lazy" referrerPolicy="no-referrer" onError={() => setIconOk(false)} />}
          <span>{kicker ?? article.provider ?? host}</span>
        </span>
        <span className="atlas-rich-title">{article.title}</span>
        {article.description && <span className="atlas-rich-summary">{article.description}</span>}
        {!authors.length && <span className="atlas-rich-host" aria-hidden="true">{article.byline ? `By ${article.byline} · ${host}` : host}</span>}
      </span>
    </a>
    {authors.length > 0 && <div className="atlas-rich-credits">
      {authors.map(a => <button key={a.acct} type="button" className="atlas-rich-creator" onClick={() => openFediProfile(a)}
        aria-label={`${CREDIT_LABEL[a.work ?? 'article']}: ${a.name} (${a.acct})`}>
        <CreatorFace a={a} />
        <span className="atlas-rich-creator-text"><small>{CREDIT_LABEL[a.work ?? 'article']}</small><b>{a.name}</b><span>{a.acct}</span></span>
        <ChevronRight className="atlas-rich-chevron" aria-hidden="true" />
      </button>)}
      <p className="atlas-rich-note"><BadgeCheck aria-hidden="true" />{attributionNote(authors[0])}</p>
    </div>}
  </div>;
}
