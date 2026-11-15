import { useState } from 'react';
import { Block, Button, Icon, Link, Navbar, NavRight, Page, Popup, Preloader } from 'framework7-react';
import { openFediProfile } from '@/lib/fedi-profile';
import { SKIP_FORWARD, skip, stop, toggle, useNowPlaying } from '@/lib/podcast-player';
import { useMiniPlayerSpace } from '@/lib/mini-player-space';
import { EpisodePlayer } from './EpisodePlayer';

/**
 * Phone: the episode keeps playing while you use the app, in a bar above the tab bar (as Apple Music and Podcasts
 * do): artwork, title and podcast, play/pause, forward 30 s, close, and a progress line. Tap it for Now Playing,
 * with the full player.
 */
export function MiniPlayer() {
  const s = useNowPlaying();
  const ep = s.episode;
  const [open, setOpen] = useState(false);
  useMiniPlayerSpace(!!ep, '64px');
  if (!ep) return null;
  const art = ep.image ?? ep.podcast.avatar;
  const progress = s.duration ? Math.min(100, (s.time / s.duration) * 100) : 0;
  return <>
    <section className="atlas-mini" aria-label="Now playing">
      <button type="button" className="atlas-mini-open" onClick={() => setOpen(true)} aria-label={`Now playing: ${ep.title}. Open player`}>
        {art ? <img src={art} alt="" referrerPolicy="no-referrer" /> : <span className="atlas-episode-initial" aria-hidden="true">{ep.podcast.name.charAt(0)}</span>}
        <span><b>{ep.title}</b><small>{ep.podcast.name}</small></span>
      </button>
      <button type="button" className="atlas-mini-btn" onClick={() => toggle(ep)} aria-label={s.playing ? `Pause ${ep.title}` : `Play ${ep.title}`} aria-pressed={s.playing}>
        {s.loading ? <Preloader size={18} /> : <Icon ios={s.playing ? 'f7:pause_fill' : 'f7:play_fill'} md={s.playing ? 'material:pause' : 'material:play_arrow'} />}
      </button>
      <button type="button" className="atlas-mini-btn" onClick={() => skip(SKIP_FORWARD)} aria-label={`Forward ${SKIP_FORWARD} seconds`}><Icon ios="f7:goforward_30" md="material:forward_30" /></button>
      <button type="button" className="atlas-mini-btn atlas-mini-close" onClick={stop} aria-label="Close player"><Icon ios="f7:xmark" md="material:close" /></button>
      <span className="atlas-mini-progress" style={{ width: `${progress}%` }} aria-hidden="true" />
    </section>
    <Popup opened={open} onPopupClosed={() => setOpen(false)} swipeToClose className="atlas-now-playing">
      <Page>
        <Navbar title="Now Playing"><NavRight><Link iconOnly popupClose aria-label="Close Now Playing"><Icon ios="f7:chevron_down" md="material:expand_more" /></Link></NavRight></Navbar>
        <Block>
          {art && <img className="atlas-now-art" src={art} alt="" referrerPolicy="no-referrer" />}
          <EpisodePlayer episode={ep} bare />
          <Button tonal round style={{ marginTop: 16 }} onClick={() => { setOpen(false); openFediProfile(ep.podcast); }}>View {ep.podcast.name}</Button>
        </Block>
      </Page>
    </Popup>
  </>;
}
