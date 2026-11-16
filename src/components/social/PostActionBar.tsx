import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Bookmark, Heart, MessageCircle, Quote, RefreshCw } from 'lucide-react';
import { requestQuote } from '@/lib/compose-intent';
import type { FedizenPost } from '@/lib/fedizen-feed';
import type { useSaveToggle } from './useFedizenLibrary';
import { compactCount, type useReactions } from './usePostActions';

type Save = ReturnType<typeof useSaveToggle>;
type Reactions = ReturnType<typeof useReactions>;

/**
 * A post's actions, the same on desktop and phone: Reply, Boost, Like and Save spread across the card's width with
 * their counts, and More at the end (Share lives there), as Bluesky and Ivory lay them out.
 *
 * Confirmation, after Phanpy (cheeaun/phanpy, src/components/status.css): each action has its own colour, the icon and
 * count take it when on, and turning it on plays a short animation — the heart bounces, the boost arrows turn, the
 * bookmark drops in. Phanpy plays it whenever a checked icon renders; here it plays only right after the tap, so
 * scrolling past posts you liked earlier doesn't set them all off. Colours: boost green and like red (the common
 * convention, also in Bluesky and Ivory), save blue (Phanpy's bookmark), defined once in styles.css.
 */
export function PostActionBar({ post: p, save, reactions, onReply, more }: { post: FedizenPost; save: Save; reactions: Reactions; onReply: (p: FedizenPost) => void; more?: ReactNode }) {
  const acts = !!p.statusId && reactions.canAct;
  const like = reactions.state(p, 'like'), boost = reactions.state(p, 'boost');
  const saved = save.isSaved(p);
  const boostable = p.visibility !== 'private' && p.visibility !== 'direct';
  // Which action was just turned on, so only that one animates.
  const [pop, setPop] = useState<'like' | 'boost' | 'save' | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const celebrate = (k: 'like' | 'boost' | 'save') => { setPop(k); if (timer.current) clearTimeout(timer.current); timer.current = setTimeout(() => setPop(null), 1200); };
  return <div className="atlas-actbar" role="group" aria-label="Post actions">
    {acts ? <>
      <button type="button" className="atlas-act" data-kind="reply" onClick={() => onReply(p)} aria-label={`Reply${p.counts?.replies ? `, ${p.counts.replies} replies` : ''}`}>
        <MessageCircle aria-hidden="true" /><span>{p.counts?.replies ? compactCount(p.counts.replies) : ''}</span>
      </button>
      <BoostMenu on={boost.on} disabled={boost.pending || !boostable} count={boost.count} pop={pop === 'boost'}
        title={boostable ? undefined : 'Only public posts can be boosted or quoted'}
        onBoost={() => { if (!boost.on) celebrate('boost'); void reactions.toggle(p, 'boost'); }}
        onQuote={() => requestQuote(p)} />
      <button type="button" className={`atlas-act${pop === 'like' ? ' pop' : ''}`} data-kind="like" aria-pressed={like.on} disabled={like.pending}
        aria-label={`${like.on ? 'Unlike' : 'Like'}${like.count ? `, ${like.count}` : ''}`}
        onClick={() => { if (!like.on) celebrate('like'); void reactions.toggle(p, 'like'); }}>
        <Heart aria-hidden="true" /><span>{like.count ? compactCount(like.count) : ''}</span>
      </button>
      {save.canSave ? <button type="button" className={`atlas-act${pop === 'save' ? ' pop' : ''}`} data-kind="save" aria-pressed={saved} disabled={save.isPending(p)}
        aria-label={saved ? 'Remove from saved' : 'Save'} onClick={() => { if (!saved) celebrate('save'); void save.toggle(p); }}>
        <Bookmark aria-hidden="true" />
      </button> : <span className="atlas-act-gap" />}
    </> : <span className="atlas-act-gap" />}
    {more}
  </div>;
}

/**
 * Boost opens a small menu, as Mastodon 4.5 clients (Ivory, Phanpy, Elk) do now that posts can be quoted: Quote, which
 * opens the composer with the post attached, and Boost or Undo boost. Drawn over the page (a portal), so a card's
 * clipping can't cut it off; Escape or a tap elsewhere closes it, and focus returns to the button.
 */
function BoostMenu({ on, disabled, count, pop, title, onBoost, onQuote }: { on: boolean; disabled: boolean; count: number; pop: boolean; title?: string; onBoost: () => void; onQuote: () => void }) {
  const [open, setOpen] = useState(false);
  const [at, setAt] = useState<{ left: number; top?: number; bottom?: number } | null>(null);
  const button = useRef<HTMLButtonElement>(null), menu = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!open || !button.current) return;
    const r = button.current.getBoundingClientRect(), w = 220, h = 112;
    const left = Math.min(Math.max(8, r.left + r.width / 2 - w / 2), window.innerWidth - w - 8);
    setAt(r.top > h + 16 ? { left, bottom: window.innerHeight - r.top + 6 } : { left, top: r.bottom + 6 });
  }, [open]);
  useEffect(() => {
    if (!open) return;
    menu.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus({ preventScroll: true });
    const close = (e: Event) => { if (!menu.current?.contains(e.target as Node) && !button.current?.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(false); button.current?.focus(); } };
    // Close when the post actually moves away (a scroll), not on the small scroll or resize focusing can cause.
    const from = button.current?.getBoundingClientRect().top ?? 0;
    const away = () => { if (Math.abs((button.current?.getBoundingClientRect().top ?? from) - from) > 12) setOpen(false); };
    document.addEventListener('pointerdown', close, true);
    document.addEventListener('keydown', key);
    window.addEventListener('scroll', away, true);
    return () => { document.removeEventListener('pointerdown', close, true); document.removeEventListener('keydown', key); window.removeEventListener('scroll', away, true); };
  }, [open]);
  const pick = (f: () => void) => () => { setOpen(false); button.current?.focus(); f(); };
  return <>
    <button ref={button} type="button" className={`atlas-act${pop ? ' pop' : ''}`} data-kind="boost" aria-pressed={on} disabled={disabled} title={title}
      aria-haspopup="menu" aria-expanded={open} aria-label={`${on ? 'Boosted' : 'Boost or quote'}${count ? `, ${count}` : ''}`} onClick={() => setOpen(o => !o)}>
      <RefreshCw aria-hidden="true" /><span>{count ? compactCount(count) : ''}</span>
    </button>
    {open && typeof document !== 'undefined' && createPortal(
      <div ref={menu} role="menu" className="atlas-boost-menu" style={at ? { left: at.left, top: at.top, bottom: at.bottom } : { visibility: 'hidden' }}
        onKeyDown={e => {
          if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
          e.preventDefault();
          const items = [...(menu.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])];
          const i = items.indexOf(document.activeElement as HTMLButtonElement);
          items[(i + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length]?.focus();
        }}>
        <button type="button" role="menuitem" onClick={pick(onQuote)}><Quote aria-hidden="true" />Quote</button>
        <button type="button" role="menuitem" onClick={pick(onBoost)}><RefreshCw aria-hidden="true" />{on ? 'Undo boost' : 'Boost'}</button>
      </div>, document.body)}
  </>;
}
