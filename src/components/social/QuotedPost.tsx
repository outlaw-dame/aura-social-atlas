import type { FedizenPost } from '@/lib/fedizen-feed';
import { shortAgo } from '@/lib/feed-types';

/**
 * The post being quoted, as it will appear under the person's text (Mastodon 4.5 quote posts; Ivory and Phanpy show
 * it the same way in their composers): author, when, the words — or only its content warning — and the start of its
 * picture. Shared by desktop and phone (styles.css .atlas-quoted).
 */
export function QuotedPost({ post: p, onRemove }: { post: FedizenPost; onRemove?: () => void }) {
  const ago = shortAgo(p.date);
  const words = p.cw ? `Content warning: ${p.cw}` : p.paragraphs.join('\n\n');
  return <figure className="atlas-quoted" aria-label={`Quoting ${p.author}`}>
    <div className="atlas-quoted-body">
      {p.avatar ? <img className="atlas-quoted-avatar atlas-avatar" src={p.avatar} alt="" width={36} height={36} referrerPolicy="no-referrer" />
        : <span className="atlas-quoted-avatar atlas-avatar" aria-hidden="true">{p.author.charAt(0)}</span>}
      <div className="atlas-quoted-main">
        <p className="atlas-quoted-who"><b>{p.author}</b> <span>{p.handle}</span>{ago && <time>{ago}</time>}</p>
        {words && <p className="atlas-quoted-text">{words}</p>}
      </div>
    </div>
    {(p.image && !p.sensitive && !p.cw) && <img className="atlas-quoted-image" src={p.image} alt="" referrerPolicy="no-referrer" loading="lazy" />}
    {onRemove && <button type="button" className="atlas-quoted-remove" aria-label="Don’t quote this post" onClick={onRemove}>×</button>}
  </figure>;
}
