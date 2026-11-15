import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Loader2, Play, PictureInPicture2, Radio } from 'lucide-react';
import { openFediProfile } from '@/lib/fedi-profile';
import type { FediVideo } from '@/lib/fedi-video';
import { clock } from '@/lib/podcast-episode';
import { hostVideo, playVideo, setHostVisible, useVideoState } from '@/lib/video-player';
import { claimMedia, releaseMedia } from '@/lib/media-focus';

/**
 * A video in a post (PeerTube, an attached video, a video podcast episode), on phone and desktop. It plays in the
 * post; scroll away or leave the page and it carries on in the floating mini player. Videos Atlas can't play
 * itself fall back to PeerTube's own embedded player, on the video's own server.
 */
export function VideoPlayer({ video, className = '' }: { video: FediVideo; className?: string }) {
  const s = useVideoState();
  const mine = s.video?.url === video.url;
  const slot = useRef<HTMLDivElement>(null);
  const [embed, setEmbed] = useState(false);
  const playable = video.sources.length > 0 || !!video.hls;

  // While this post's video is loaded, the post hosts it whenever the post is on screen.
  useLayoutEffect(() => {
    const el = slot.current;
    if (!mine || !el) return;
    const off = hostVideo(video.url, el, true);
    const io = new IntersectionObserver(([e]) => setHostVisible(el, e.isIntersecting && e.intersectionRatio >= 0.35), { threshold: [0, 0.35, 1] });
    io.observe(el);
    return () => { io.disconnect(); off(); };
  }, [mine, video.url]);

  // PeerTube's own player can't be paused from here, so when anything else starts it closes, and when it opens
  // everything else pauses.
  useEffect(() => {
    if (!embed) return;
    const owner = `embed:${video.url}`;
    claimMedia(owner, () => setEmbed(false));
    return () => releaseMedia(owner);
  }, [embed, video.url]);

  const ratio = video.aspect ?? 16 / 9;
  const start = () => { if (playable) void playVideo(video); else if (video.embed) setEmbed(true); };
  const host = (() => { try { return new URL(video.url).hostname; } catch { return ''; } })();
  return <section className={`atlas-video ${className}`} aria-label={video.title ? `Video: ${video.title}` : 'Video'}>
    <div className="atlas-video-frame" style={{ aspectRatio: String(ratio) }} data-video-slot={video.url}>
      {embed && video.embed
        ? <iframe src={`${video.embed}?autoplay=1&title=0&warningTitle=0&peertubeLink=0`} title={video.title ?? 'PeerTube video'} allow="autoplay; fullscreen; picture-in-picture"
            sandbox="allow-same-origin allow-scripts allow-popups allow-presentation" referrerPolicy="no-referrer" loading="lazy" className="atlas-video-iframe" />
        : mine
          ? <div ref={slot} className="atlas-video-slot">
              {s.mode === 'floating' && <p className="atlas-video-away"><PictureInPicture2 aria-hidden="true" /> Playing in the mini player</p>}
            </div>
          : <button type="button" className="atlas-video-poster" onClick={start} aria-label={`Play ${video.title ?? 'video'}`}>
              {video.poster && <img src={video.poster} alt="" loading="lazy" referrerPolicy="no-referrer" />}
              <span className="atlas-video-play" aria-hidden="true">{mine && s.loading ? <Loader2 className="animate-spin" /> : <Play />}</span>
              {video.live ? <span className="atlas-video-badge atlas-video-live"><Radio aria-hidden="true" />LIVE</span>
                : video.duration ? <span className="atlas-video-badge">{clock(video.duration)}</span> : null}
            </button>}
    </div>
    {(video.title || video.creator) && <div className="atlas-video-meta">
      {video.title && <a href={video.url} target="_blank" rel="noopener noreferrer" className="atlas-video-title">{video.title}</a>}
      {video.creator && <button type="button" className="atlas-video-creator" onClick={() => openFediProfile(video.creator!)} aria-label={`${video.creator.name} (${video.creator.acct})`}>
        {video.creator.avatar ? <img src={video.creator.avatar} alt="" width={28} height={28} referrerPolicy="no-referrer" /> : <span className="atlas-episode-initial" aria-hidden="true">{video.creator.name.charAt(0)}</span>}
        <span><b>{video.creator.name}</b><small>{video.creator.acct}</small></span>
      </button>}
      {!video.creator && host && <small className="atlas-video-host">{host}</small>}
    </div>}
    {mine && s.error && <p role="alert" className="atlas-article-note">This video couldn’t be played here.{video.embed ? <> <button type="button" className="underline" onClick={() => setEmbed(true)}>Use its own player</button></> : <> <a href={video.url} target="_blank" rel="noopener noreferrer" className="underline">Open it on {host}</a></>}</p>}
  </section>;
}
