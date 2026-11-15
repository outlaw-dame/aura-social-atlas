import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CornerUpLeft, Pause, PictureInPicture2, Play, Volume2, VolumeX, X } from 'lucide-react';
import { canSystemPip, closeVideo, dockFrame, seekVideo, systemPip, toggleMute, togglePlay, useVideoState } from '@/lib/video-player';
import { clock } from '@/lib/podcast-episode';

/**
 * The floating video player (after Arc's Mini Player): when a playing video leaves the screen it floats in a
 * corner. Drag it to any corner, drag its handle to resize, hover (or tap) for controls: back to the post,
 * play/pause, mute, the system's picture-in-picture, close, and a scrubber.
 */
type Corner = 'br' | 'bl' | 'tr' | 'tl';
const MIN_W = 200, MAX_W = 640;

export function VideoDock() {
  const s = useVideoState();
  const [frame, setFrame] = useState<HTMLElement | null>(null);
  const [corner, setCorner] = useState<Corner>('br');
  const [width, setWidth] = useState(320);
  const drag = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  useEffect(() => { setFrame(dockFrame()); }, []);
  useEffect(() => {
    if (!frame) return;
    frame.dataset.corner = corner;
    frame.style.setProperty('--pip-w', `${width}px`);
  }, [frame, corner, width]);
  if (!frame || s.mode !== 'floating' || !s.video) return null;
  const video = s.video;
  const total = s.duration;

  const onPointerDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('button, input')) return;
    drag.current = { x: e.clientX, y: e.clientY, moved: false };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x, dy = e.clientY - d.y;
    if (Math.abs(dx) + Math.abs(dy) > 6) d.moved = true;
    frame.style.translate = d.moved ? `${dx}px ${dy}px` : '';
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    frame.style.translate = '';
    if (!d?.moved) return;
    // Snap to the nearest corner, as picture-in-picture does on iOS.
    setCorner(`${e.clientY > innerHeight / 2 ? 'b' : 't'}${e.clientX > innerWidth / 2 ? 'r' : 'l'}` as Corner);
  };
  const resize = (e: React.PointerEvent) => {
    e.stopPropagation();
    const startX = e.clientX, startW = width, left = corner.endsWith('r');
    const move = (ev: PointerEvent) => setWidth(Math.round(Math.max(MIN_W, Math.min(MAX_W, startW + (left ? startX - ev.clientX : ev.clientX - startX)))));
    const up = () => { removeEventListener('pointermove', move); removeEventListener('pointerup', up); };
    addEventListener('pointermove', move); addEventListener('pointerup', up);
  };
  const backToPost = () => {
    const post = document.querySelector<HTMLElement>(`[data-video-slot="${CSS.escape(video.url)}"]`);
    if (post) post.scrollIntoView({ behavior: 'smooth', block: 'center' });
    else window.open(video.url, '_blank', 'noopener,noreferrer');
  };

  return createPortal(<div className="atlas-pip-ui" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} role="region" aria-label={`Mini player: ${video.title ?? 'video'}`}>
    <div className="atlas-pip-top">
      <button type="button" onClick={backToPost} aria-label="Back to the post" title="Back to the post"><CornerUpLeft /></button>
      <span className="atlas-pip-title">{video.title}</span>
      <button type="button" onClick={closeVideo} aria-label="Close video" title="Close"><X /></button>
    </div>
    <button type="button" className="atlas-pip-center" onClick={togglePlay} aria-label={s.playing ? 'Pause' : 'Play'} aria-pressed={s.playing}>{s.playing ? <Pause /> : <Play />}</button>
    <div className="atlas-pip-bottom">
      <button type="button" onClick={toggleMute} aria-label={s.muted ? 'Unmute' : 'Mute'} aria-pressed={s.muted}>{s.muted ? <VolumeX /> : <Volume2 />}</button>
      <input type="range" min={0} max={Math.max(1, Math.round(total ?? 0))} step={1} value={Math.round(s.time)} disabled={!total || video.live}
        onChange={e => seekVideo(Number(e.target.value))} aria-label="Seek" aria-valuetext={total ? `${clock(s.time)} of ${clock(total)}` : clock(s.time)} />
      {canSystemPip() && <button type="button" onClick={() => void systemPip()} aria-label="Picture in picture" title="Picture in picture"><PictureInPicture2 /></button>}
    </div>
    <span className="atlas-pip-resize" onPointerDown={resize} aria-hidden="true" />
  </div>, frame);
}
