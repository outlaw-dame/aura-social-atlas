import { createContext, useContext, useState, type ReactNode } from 'react';
import { WarningMark } from './FilterGate';
import { useReading, veilReason } from '@/lib/reading-prefs';

/** Set by a filter gate whose filter hides only media ("blur"): why, and how to show it. */
export const MediaVeilContext = createContext<{ reason: string; onShow: () => void } | null>(null);

/**
 * A post's image or video behind a veil, as Bluesky and Ivory do: blurred, with a centred warning mark, "Sensitive",
 * the reason, and View. Veiled when the person's filter hides media (the reason names the filter), when the author
 * marked it sensitive, or for all media under "Blur all media" — unless the reader chose "Show all media"
 * (lib/reading-prefs). Shared by desktop and phone; `cta` is the action's words ("Tap to view" on phones).
 */
export function SensitiveMedia({ sensitive, cta = 'View media', children }: { sensitive?: boolean; cta?: string; children: ReactNode }) {
  const filter = useContext(MediaVeilContext);
  const [shown, setShown] = useState(false);
  const reason = veilReason(useReading(), filter?.reason ?? null, sensitive);
  if (!children) return null;
  if (!reason || shown) return <>{children}</>;
  return <div className="atlas-sensitive">
    {/* inert: the hidden media can't be focused, played or opened until shown. */}
    <div className="atlas-sensitive-media" aria-hidden="true" inert>{children}</div>
    <button type="button" className="atlas-sensitive-veil" onClick={() => { setShown(true); filter?.onShow(); }}>
      <WarningMark />
      <b>Sensitive</b>
      <span>{reason}</span>
      <em>{cta}</em>
    </button>
  </div>;
}
