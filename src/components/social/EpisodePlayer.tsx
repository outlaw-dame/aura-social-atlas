import { useState } from 'react';
import { Loader2, Pause, Play, RotateCcw, RotateCw } from 'lucide-react';
import { openFediProfile } from '@/lib/fedi-profile';
import { clock, type FediEpisode } from '@/lib/podcast-episode';
import { SKIP_BACK, SKIP_FORWARD, seek, skip, toggle, useEpisodePlayback } from '@/lib/podcast-player';

/**
 * A podcast episode played in place (desktop): artwork, title, and the podcast with its handle stacked under its
 * name, which opens the podcast's profile in Atlas; play/pause, a scrubber with elapsed and remaining time, and
 * skip back 15 s / forward 30 s. One episode plays at a time across Atlas.
 */

function Art({ src, fallback, className }: { src?: string; fallback: string; className: string }) {
  const [broken, setBroken] = useState(false);
  return src && !broken
    ? <img src={src} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setBroken(true)} className={`${className} object-cover`} />
    : <span aria-hidden="true" className={`${className} flex items-center justify-center bg-muted font-serif text-xl`}>{fallback.charAt(0)}</span>;
}

export function EpisodePlayer({ episode: ep }: { episode: FediEpisode }) {
  const p = useEpisodePlayback(ep);
  const total = p.duration;
  const label = p.playing ? `Pause ${ep.title}` : `Play ${ep.title}`;
  return <section aria-label={`Podcast episode: ${ep.title}`} className="mt-3 rounded-3xl border border-border bg-muted/40 p-3 shadow-sm">
    <div className="flex items-center gap-3">
      <Art src={ep.image ?? ep.podcast.avatar} fallback={ep.podcast.name} className="size-20 shrink-0 rounded-2xl ring-1 ring-border" />
      <div className="min-w-0 flex-1">
        <a href={ep.url} target="_blank" rel="noopener noreferrer" className="line-clamp-2 text-sm font-semibold leading-snug hover:underline">{ep.title}</a>
        <button type="button" onClick={() => openFediProfile(ep.podcast)} className="mt-1.5 flex max-w-full items-center gap-2 rounded-xl text-left hover:opacity-80" aria-label={`Podcast: ${ep.podcast.name} (${ep.podcast.acct})`}>
          <Art src={ep.podcast.avatar} fallback={ep.podcast.name} className="size-7 shrink-0 rounded-lg" />
          <span className="min-w-0"><span className="block truncate text-xs font-medium">{ep.podcast.name}</span><span className="block truncate text-[11px] text-muted-foreground">{ep.podcast.acct}</span></span>
        </button>
      </div>
      <button type="button" onClick={() => toggle(ep)} aria-label={label} aria-pressed={p.playing}
        className="flex size-12 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground shadow-md transition-transform hover:scale-105 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
        {p.loading ? <Loader2 className="size-5 animate-spin" /> : p.playing ? <Pause className="size-5 fill-current" /> : <Play className="ml-0.5 size-5 fill-current" />}
      </button>
    </div>
    <div className="mt-3 flex items-center gap-2">
      <button type="button" disabled={!p.active} onClick={() => skip(-SKIP_BACK)} aria-label={`Back ${SKIP_BACK} seconds`} className="relative flex size-9 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40">
        <RotateCcw className="size-5" /><span className="absolute text-[8px] font-bold">{SKIP_BACK}</span>
      </button>
      <span className="w-12 shrink-0 text-right text-[11px] tabular-nums text-muted-foreground">{clock(p.time)}</span>
      <input type="range" min={0} max={Math.max(1, Math.round(total ?? 0))} step={1} value={Math.round(p.time)} disabled={!p.active || !total}
        onChange={e => seek(Number(e.target.value))} aria-label="Seek"
        aria-valuetext={total ? `${clock(p.time)} of ${clock(total)}` : clock(p.time)}
        className="h-1.5 min-w-0 flex-1 cursor-pointer accent-[var(--accent)] disabled:cursor-default" />
      <span className="w-12 shrink-0 text-[11px] tabular-nums text-muted-foreground">{total ? `-${clock(total - p.time)}` : '--:--'}</span>
      <button type="button" disabled={!p.active} onClick={() => skip(SKIP_FORWARD)} aria-label={`Forward ${SKIP_FORWARD} seconds`} className="relative flex size-9 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40">
        <RotateCw className="size-5" /><span className="absolute text-[8px] font-bold">{SKIP_FORWARD}</span>
      </button>
    </div>
    {p.error && <p role="alert" className="mt-2 text-xs text-muted-foreground">This episode’s audio couldn’t be played. <a href={ep.url} target="_blank" rel="noopener noreferrer" className="underline">Open it on {new URL(ep.url).hostname}</a></p>}
  </section>;
}
