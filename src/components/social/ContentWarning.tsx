import { useState, type ReactNode } from 'react';
import { WarningMark } from './FilterGate';
import { useReading } from '@/lib/reading-prefs';

/**
 * The centred warning panel shared by filtered posts and authors' content warnings: a warning mark, a bold line,
 * a quieter line under it, and the action. `phone` uses the Framework7 styles (styles.css), desktop Tailwind.
 */
export function WarningPanel({ title, detail, cta, onClick, phone = false }: { title: string; detail?: string; cta: string; onClick: () => void; phone?: boolean }) {
  if (phone) return <button type="button" className="atlas-filter-warning" onClick={onClick}>
    <WarningMark /><b>{title}</b>{detail && <span>{detail}</span>}<em>{cta}</em>
  </button>;
  return <button type="button" onClick={onClick} className="mt-3 flex w-full flex-col items-center gap-1 rounded-2xl bg-muted/60 px-6 py-7 text-center transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
    <WarningMark className="mb-1" />
    <span className="text-base font-semibold [overflow-wrap:anywhere]">{title}</span>
    {detail && <span className="text-sm text-muted-foreground">{detail}</span>}
    <span className="mt-1 text-sm font-semibold text-accent">{cta}</span>
  </button>;
}

/** What the panel says under an author's warning. */
export const AUTHOR_CW = 'Content warning from the author';

/**
 * A post's own content warning (Mastodon's `spoiler_text`, ActivityStreams' `summary` on a Note), as Mastodon shows it:
 * the warning stands in for everything it covers — text, media, link preview — until opened, and can be closed again.
 * The author line and the post's actions stay outside it. Media marked sensitive stays veiled after the warning is
 * opened (SensitiveMedia), as on Mastodon, where a warning also marks the media sensitive.
 */
export function AuthorWarning({ cw, article, credits, after, phone = false, children }: {
  cw?: string; /** A long-form article from another server (FedizenPost.longform). */ article?: { title: string; lede: string };
  /** Its credited authors, shown with its title and standfirst (foldCredits), and those its body doesn't show (`after`). */
  credits?: ReactNode; after?: ReactNode; phone?: boolean; children: ReactNode;
}) {
  const { expandWarnings } = useReading();
  // Opened by default under "Always expand content warnings"; Hide still folds it.
  const [choice, setOpen] = useState<boolean | null>(null);
  const open = choice ?? expandWarnings;
  if (article && !cw) return <ArticleFold article={article} credits={credits} open={open} onOpen={() => setOpen(true)} phone={phone}>{children}{after}</ArticleFold>;
  if (!cw) return <>{children}</>;
  if (!open) return <WarningPanel title={cw} detail={AUTHOR_CW} cta={phone ? 'Tap to view' : 'Show post'} onClick={() => setOpen(true)} phone={phone} />;
  return <>
    {phone
      ? <p className="atlas-cw-open"><span>{cw}</span><button type="button" onClick={() => setOpen(false)}>Hide</button></p>
      : <p className="mt-3 flex items-center gap-2 text-xs text-muted-foreground"><span className="min-w-0 flex-1 [overflow-wrap:anywhere]"><span className="font-semibold">Content warning:</span> {cw}</span><button type="button" onClick={() => setOpen(false)} className="shrink-0 font-medium hover:text-foreground">Hide</button></p>}
    {children}
  </>;
}

/**
 * A long-form article from another server, as a reader opens one: its title and standfirst, then the whole article on
 * Read. Its summary may be a standfirst or the author's warning (fedizen-feed.ts longformOf), so, like a warning, the
 * body and media wait until it's opened; "Always expand content warnings" opens it too.
 */
function ArticleFold({ article, credits, open, onOpen, phone, children }: { article: { title: string; lede: string }; credits?: ReactNode; open: boolean; onOpen: () => void; phone: boolean; children: ReactNode }) {
  if (open) return <>{children}</>;
  if (phone) return <div className="atlas-article-fold">
    <b>{article.title}</b><p>{article.lede}</p>
    <button type="button" onClick={onOpen}>Read article</button>
    {credits}
  </div>;
  return <div className="mt-3">
    <p className="font-serif text-xl leading-snug [overflow-wrap:anywhere]">{article.title}</p>
    <p className="mt-1 line-clamp-4 text-sm leading-relaxed text-muted-foreground [overflow-wrap:anywhere]">{article.lede}</p>
    <button type="button" onClick={onOpen} className="mt-2 text-sm font-semibold text-accent hover:underline">Read article</button>
    {credits}
  </div>;
}
