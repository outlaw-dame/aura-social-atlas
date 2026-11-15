import { Icon, Link, Preloader } from 'framework7-react';
import { openFediProfile } from '@/lib/fedi-profile';
import { clock, type FediEpisode } from '@/lib/podcast-episode';
import { SKIP_BACK, SKIP_FORWARD, seek, skip, toggle, useEpisodePlayback } from '@/lib/podcast-player';

/**
 * Phone: a podcast episode played in place — artwork, title, the podcast with its handle stacked under its name
 * (opens its profile in Atlas), play/pause, scrubber, skip back 15 s / forward 30 s. Shares one player with desktop.
 */
export function EpisodePlayer({ episode: ep }: { episode: FediEpisode }) {
  const p = useEpisodePlayback(ep);
  const total = p.duration;
  const art = ep.image ?? ep.podcast.avatar;
  return <section className="atlas-episode" aria-label={`Podcast episode: ${ep.title}`}>
    <div className="atlas-episode-top">
      {art ? <img className="atlas-episode-art" src={art} alt="" loading="lazy" referrerPolicy="no-referrer" /> : <span className="atlas-episode-art atlas-episode-initial" aria-hidden="true">{ep.podcast.name.charAt(0)}</span>}
      <div className="atlas-episode-copy">
        <Link external target="_blank" href={ep.url} className="atlas-episode-title">{ep.title}</Link>
        <Link onClick={() => openFediProfile(ep.podcast)} className="atlas-episode-show" aria-label={`Podcast: ${ep.podcast.name} (${ep.podcast.acct})`}>
          {ep.podcast.avatar ? <img src={ep.podcast.avatar} alt="" width={28} height={28} referrerPolicy="no-referrer" /> : <span className="atlas-episode-initial" aria-hidden="true">{ep.podcast.name.charAt(0)}</span>}
          <span><b>{ep.podcast.name}</b><small>{ep.podcast.acct}</small></span>
        </Link>
      </div>
      <button type="button" className="atlas-episode-play" onClick={() => toggle(ep)} aria-label={p.playing ? `Pause ${ep.title}` : `Play ${ep.title}`} aria-pressed={p.playing}>
        {p.loading ? <Preloader size={20} color="white" /> : <Icon ios={p.playing ? 'f7:pause_fill' : 'f7:play_fill'} md={p.playing ? 'material:pause' : 'material:play_arrow'} />}
      </button>
    </div>
    <div className="atlas-episode-bar">
      <button type="button" className="atlas-episode-skip" disabled={!p.active} onClick={() => skip(-SKIP_BACK)} aria-label={`Back ${SKIP_BACK} seconds`}><Icon ios="f7:gobackward_15" md="material:replay" /></button>
      <span className="atlas-episode-time">{clock(p.time)}</span>
      <input type="range" min={0} max={Math.max(1, Math.round(total ?? 0))} step={1} value={Math.round(p.time)} disabled={!p.active || !total}
        onChange={e => seek(Number(e.target.value))} aria-label="Seek" aria-valuetext={total ? `${clock(p.time)} of ${clock(total)}` : clock(p.time)} />
      <span className="atlas-episode-time">{total ? `-${clock(total - p.time)}` : '--:--'}</span>
      <button type="button" className="atlas-episode-skip" disabled={!p.active} onClick={() => skip(SKIP_FORWARD)} aria-label={`Forward ${SKIP_FORWARD} seconds`}><Icon ios="f7:goforward_30" md="material:forward_30" /></button>
    </div>
    {p.error && <p role="alert" className="atlas-article-note">This episode’s audio couldn’t be played. <Link external target="_blank" href={ep.url}>Open it</Link></p>}
  </section>;
}
