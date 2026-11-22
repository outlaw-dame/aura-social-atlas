import { Loader2, Pause, Play, RotateCcw, RotateCw, X } from 'lucide-react';
import { openFediProfile } from '@/lib/fedi-profile';
import { clock } from '@/lib/podcast-episode';
import { MINI_PLAYER_OFFSET, useMiniPlayerSpace } from '@/lib/mini-player-space';
import { SKIP_BACK, SKIP_FORWARD, seek, skip, stop, toggle, useNowPlaying } from '@/lib/podcast-player';

/**
 * Desktop: the episode keeps playing while you browse. A floating bar with the artwork, title and podcast (opens
 * its profile), skip back 15 s, play/pause, forward 30 s, a scrubber, and close.
 */
export function MiniPlayer() {
  const s = useNowPlaying();
  const ep = s.episode;
  useMiniPlayerSpace(!!ep, MINI_PLAYER_OFFSET);
  if (!ep) return null;
  const total = s.duration;
  const art = ep.image ?? ep.podcast.avatar;
  return <section aria-label="Now playing" className="liquid-glass fixed bottom-4 left-1/2 z-40 flex w-[min(44rem,calc(100vw-2rem))] -translate-x-1/2 items-center gap-3 rounded-2xl border border-border bg-card/90 p-2 pr-3 shadow-2xl backdrop-blur-xl">
    {art ? <img src={art} alt="" referrerPolicy="no-referrer" className="size-12 shrink-0 rounded-xl object-cover" /> : <span aria-hidden="true" className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-muted font-serif text-lg">{ep.podcast.name.charAt(0)}</span>}
    <div className="min-w-0 flex-1">
      <p className="truncate text-sm font-semibold" title={ep.title}>{ep.title}</p>
      <button type="button" onClick={() => openFediProfile(ep.podcast)} className="block max-w-full truncate text-left text-xs text-muted-foreground hover:text-foreground">{ep.podcast.name} <span className="opacity-70">{ep.podcast.acct}</span></button>
      <div className="mt-1 hidden items-center gap-2 sm:flex">
        <span className="w-10 text-right text-[10px] tabular-nums text-muted-foreground">{clock(s.time)}</span>
        <input type="range" min={0} max={Math.max(1, Math.round(total ?? 0))} step={1} value={Math.round(s.time)} disabled={!total} onChange={e => seek(Number(e.target.value))}
          aria-label="Seek" aria-valuetext={total ? `${clock(s.time)} of ${clock(total)}` : clock(s.time)} className="h-1 min-w-0 flex-1 cursor-pointer accent-[var(--accent)]" />
        <span className="w-10 text-[10px] tabular-nums text-muted-foreground">{total ? `-${clock(total - s.time)}` : '--:--'}</span>
      </div>
    </div>
    <button type="button" onClick={() => skip(-SKIP_BACK)} aria-label={`Back ${SKIP_BACK} seconds`} className="relative hidden size-9 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground sm:flex"><RotateCcw className="size-5" /><span className="absolute text-[8px] font-bold">{SKIP_BACK}</span></button>
    <button type="button" onClick={() => toggle(ep)} aria-label={s.playing ? `Pause ${ep.title}` : `Play ${ep.title}`} aria-pressed={s.playing}
      className="flex size-11 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground shadow-md transition-transform hover:scale-105 active:scale-95">
      {s.loading ? <Loader2 className="size-5 animate-spin" /> : s.playing ? <Pause className="size-5 fill-current" /> : <Play className="ml-0.5 size-5 fill-current" />}
    </button>
    <button type="button" onClick={() => skip(SKIP_FORWARD)} aria-label={`Forward ${SKIP_FORWARD} seconds`} className="relative flex size-9 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"><RotateCw className="size-5" /><span className="absolute text-[8px] font-bold">{SKIP_FORWARD}</span></button>
    <button type="button" onClick={stop} aria-label="Close player" className="flex size-8 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"><X className="size-4" /></button>
    {s.error && <p role="alert" className="sr-only">This episode’s audio couldn’t be played.</p>}
  </section>;
}
