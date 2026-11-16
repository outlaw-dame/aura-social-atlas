import { useState, type ReactNode } from 'react';
import { WarningMark } from './FilterGate';

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
export function AuthorWarning({ cw, phone = false, children }: { cw?: string; phone?: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  if (!cw) return <>{children}</>;
  if (!open) return <WarningPanel title={cw} detail={AUTHOR_CW} cta={phone ? 'Tap to view' : 'Show post'} onClick={() => setOpen(true)} phone={phone} />;
  return <>
    {phone
      ? <p className="atlas-cw-open"><span>{cw}</span><button type="button" onClick={() => setOpen(false)}>Hide</button></p>
      : <p className="mt-3 flex items-center gap-2 text-xs text-muted-foreground"><span className="min-w-0 flex-1 [overflow-wrap:anywhere]"><span className="font-semibold">Content warning:</span> {cw}</span><button type="button" onClick={() => setOpen(false)} className="shrink-0 font-medium hover:text-foreground">Hide</button></p>}
    {children}
  </>;
}
