import { Check } from 'lucide-react';
import { ACCENTS, foregroundFor, setAccent, useAccent } from '@/lib/accent';

/** Settings → Appearance: the accent used for buttons, the player and highlights across Atlas. The swatch size is set
 *  inline because Framework7's unlayered `button { width: 100% }` would otherwise beat Tailwind's size-9 on the phone. */
export function AccentPicker() {
  const accent = useAccent();
  return <div role="radiogroup" aria-label="Accent color" className="flex flex-wrap gap-3">
    {ACCENTS.map(a => <button key={a.id} type="button" role="radio" aria-checked={accent === a.id} aria-label={a.name} title={a.name} onClick={() => setAccent(a.id)}
      className="flex size-9 items-center justify-center rounded-full ring-offset-2 ring-offset-background transition-transform hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-checked:ring-2 aria-checked:ring-foreground/40"
      style={{ background: a.hex, color: foregroundFor(a.hex), width: 36, height: 36, flex: 'none', padding: 0, border: 0 }}>
      {accent === a.id && <Check className="size-4" strokeWidth={3} />}
    </button>)}
  </div>;
}
