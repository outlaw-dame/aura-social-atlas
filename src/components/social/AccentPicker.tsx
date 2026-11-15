import { Check } from 'lucide-react';
import { ACCENTS, foregroundFor, setAccent, useAccent } from '@/lib/accent';

/** Settings → Appearance: the accent used for buttons, the player and highlights across Atlas. */
export function AccentPicker() {
  const accent = useAccent();
  return <div role="radiogroup" aria-label="Accent color" className="flex flex-wrap gap-3">
    {ACCENTS.map(a => <button key={a.id} type="button" role="radio" aria-checked={accent === a.id} aria-label={a.name} title={a.name} onClick={() => setAccent(a.id)}
      className="flex size-9 items-center justify-center rounded-full ring-offset-2 ring-offset-background transition-transform hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-checked:ring-2 aria-checked:ring-foreground/40"
      style={{ background: a.hex, color: foregroundFor(a.hex) }}>
      {accent === a.id && <Check className="size-4" strokeWidth={3} />}
    </button>)}
  </div>;
}
