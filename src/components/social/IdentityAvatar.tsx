import { useEffect, useState } from 'react';

/** Never display an unrelated preset as a verified Fedizen account. */
export function IdentityAvatar({
  src, name, className, alt = '',
}: { src: string | null; name: string; className?: string; alt?: string }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  return src && !failed
    ? <img src={src} alt={alt} className={className} referrerPolicy="no-referrer" onError={() => setFailed(true)} />
    : <span aria-label={alt || undefined} aria-hidden={!alt} className={`inline-flex items-center justify-center bg-muted text-muted-foreground font-semibold ${className ?? ''}`}>{name.trim().charAt(0).toUpperCase() || '?'}</span>;
}
