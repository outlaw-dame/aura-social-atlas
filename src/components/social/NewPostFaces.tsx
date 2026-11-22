import type { NewPostFace } from '@/lib/new-post-faces';

/**
 * The faces on the new-posts pill (desktop and phone): up to three people whose waiting posts are above the feed,
 * overlapping, after Ivory and Mastodon for iOS. Decorative: the pill's label says whose posts they are. Each face
 * follows the reader's avatar shape; one without a picture shows its initial.
 */
export function NewPostFaces({ faces }: { faces: readonly NewPostFace[] }) {
  if (!faces.length) return null;
  return <span className="atlas-new-faces" aria-hidden="true">
    {faces.map(f => f.avatar
      ? <img key={f.key} src={f.avatar} alt="" className="atlas-new-face" referrerPolicy="no-referrer" decoding="async" />
      : <span key={f.key} className="atlas-new-face atlas-new-face-initial">{f.name.trim().charAt(0).toUpperCase() || '?'}</span>)}
  </span>;
}
