import { Switch } from '@/components/ui/switch';
import { MEDIA_DISPLAY, setReading, useReading } from '@/lib/reading-prefs';

/** Desktop: Settings → Appearance → Content warnings and Sensitive media (lib/reading-prefs). */
export function ReadingSettings() {
  const r = useReading();
  return <>
    <h2 className="mb-1 mt-8 text-base font-semibold">Content warnings</h2>
    <label className="flex items-start justify-between gap-4 text-sm">
      <span><span className="font-medium">Always expand content warnings</span><span className="block text-xs text-muted-foreground">Show posts behind an author’s content warning without a tap. You can still fold them with Hide.</span></span>
      <Switch checked={r.expandWarnings} onCheckedChange={v => setReading({ expandWarnings: v })} />
    </label>
    <h2 className="mb-1 mt-8 text-base font-semibold">Sensitive media</h2>
    <p className="mb-3 text-sm text-muted-foreground">Media your keyword filters hide stays hidden either way.</p>
    <div role="radiogroup" aria-label="Sensitive media" className="space-y-2">
      {MEDIA_DISPLAY.map(m => <label key={m.id} className="flex cursor-pointer items-start gap-3 rounded-xl border border-border p-3 text-sm has-[:checked]:border-ring has-[:checked]:bg-secondary">
        <input type="radio" name="atlas-media-display" className="mt-1 accent-[var(--accent)]" checked={r.media === m.id} onChange={() => setReading({ media: m.id })} />
        <span><span className="font-medium">{m.name}</span><span className="block text-xs text-muted-foreground">{m.note}</span></span>
      </label>)}
    </div>
    <h2 className="mb-1 mt-8 text-base font-semibold">Posting</h2>
    <label className="flex items-start justify-between gap-4 text-sm">
      <span><span className="font-medium">Alt text reminder</span><span className="block text-xs text-muted-foreground">Before posting images or a video without alt text, ask whether to add it. Alt text is what screen readers say in place of the picture.</span></span>
      <Switch checked={r.altReminder} onCheckedChange={v => setReading({ altReminder: v })} />
    </label>
  </>;
}
