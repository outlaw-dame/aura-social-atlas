import { useState } from 'react';
import type { PostArticle } from '@/lib/fedizen-feed';

/** Safe inside url("…"): the characters that could end the string are percent-encoded. */
const cssUrl = (u: string) => u.replace(/["\\\n\r()']/g, c => `%${c.charCodeAt(0).toString(16).padStart(2, '0')}`);
const hostOf = (url: string) => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; } };

/**
 * A link preview in the manner of Particle's story cards: the article's image runs edge to edge and fades into a
 * panel tinted by the image itself (a blurred copy, so no colour has to be read from a cross-origin image), with the
 * publisher, the headline and the summary on it. Without an image it's the same panel in the card's own colours.
 * Phone and desktop share it; `kicker` replaces the publisher line (e.g. "Podcast episode · …").
 */
export function RichLink({ article, kicker }: { article: PostArticle; kicker?: string }) {
  const host = hostOf(article.url);
  const [imageOk, setImageOk] = useState(true);
  const [iconOk, setIconOk] = useState(true);
  const image = article.image && imageOk ? article.image : undefined;
  if (!article.title) return null;
  return <a href={article.url} target="_blank" rel="noopener noreferrer" className={`external atlas-rich-link${image ? ' has-image' : ''}`}>
    {image && <>
      <span className="atlas-rich-tint" aria-hidden="true" style={{ backgroundImage: `url("${cssUrl(image)}")` }} />
      <img className="atlas-rich-image" src={image} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setImageOk(false)} />
    </>}
    <span className="atlas-rich-body">
      <span className="atlas-rich-meta">
        {host && iconOk && <img src={`https://${host}/favicon.ico`} alt="" width={16} height={16} loading="lazy" referrerPolicy="no-referrer" onError={() => setIconOk(false)} />}
        <span>{kicker ?? article.provider ?? host}</span>
      </span>
      <span className="atlas-rich-title">{article.title}</span>
      {article.description && <span className="atlas-rich-summary">{article.description}</span>}
      <span className="atlas-rich-host" aria-hidden="true">{host}</span>
    </span>
  </a>;
}
