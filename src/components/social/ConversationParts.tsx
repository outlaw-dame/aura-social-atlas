import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import type { FedizenPost } from '@/lib/fedizen-feed';
import { fullAcct } from '@/lib/fedizen-feed';
import type { Thread } from '@/lib/thread';
import { allPosts, latestTime, participantsOf, readMarks, rootOf, writeMark, type ReplyMode } from '@/lib/conversation';
import { getFedizenStatus } from '@/lib/fedizen.functions';
import { useAtlasAuth } from './AuthState';

/**
 * Parts of a conversation page (ConversationThread.tsx), shared by desktop (ThreadView.tsx) and the phone
 * (f7/Thread.tsx): the reading mode, faces and participants, the reader's own handle, keeping the reader's place
 * while the conversation changes, and where they left off last time.
 */

function stored<T extends string>(k: string, ok: readonly T[], fallback: T): T {
  try { const v = localStorage.getItem(k) as T | null; return v && ok.includes(v) ? v : fallback; } catch { return fallback; }
}
function useStored<T extends string>(k: string, ok: readonly T[], fallback: T): [T, (v: T) => void] {
  const [v, setV] = useState<T>(() => stored(k, ok, fallback));
  return [v, (n: T) => { setV(n); try { localStorage.setItem(k, n); } catch { /* per-device only */ } }];
}
/** Nested or flat (Bonfire's reading modes), kept on this device. The key predates the single design; kept so the
 *  reader's choice carries over. */
export const useReplyMode = () => useStored<ReplyMode>('atlas.proto.replyMode', ['nested', 'flat'], 'nested');

/** Bonfire's reading modes for the replies, nested or flat. */
export function ReplyModeSwitch({ mode, setMode }: { mode: ReplyMode; setMode: (m: ReplyMode) => void }) {
  return <div role="radiogroup" aria-label="Show replies" className="atlas-proto-switch atlas-proto-small">
    {(['nested', 'flat'] as const).map(m => <button key={m} type="button" role="radio" aria-checked={mode === m} onClick={() => setMode(m)} className={mode === m ? 'is-on' : undefined}>{m === 'nested' ? 'Nested' : 'Flat'}</button>)}
  </div>;
}

export function Face({ post: p, size = 28 }: { post: FedizenPost; size?: number }) {
  const [broken, setBroken] = useState(false);
  return p.avatar && !broken
    ? <img className="atlas-conv-face" src={p.avatar} alt="" width={size} height={size} style={{ width: size, height: size }} loading="lazy" referrerPolicy="no-referrer" onError={() => setBroken(true)} />
    : <span className="atlas-conv-face" aria-hidden="true" style={{ width: size, height: size, fontSize: size * 0.45 }}>{p.author.charAt(0)}</span>;
}

/** Who's in the conversation (Bonfire's participants), most active first. */
export function ParticipantsStrip({ thread }: { thread: Thread }) {
  const people = participantsOf(allPosts(thread));
  if (people.length < 2) return null;
  const shown = people.slice(0, 8);
  return <div className="atlas-conv-people" aria-label={`${people.length} people in this conversation`}>
    <span className="atlas-conv-faces" aria-hidden="true">{shown.map(x => <Face key={x.post.handle} post={x.post} size={24} />)}</span>
    <span>{people.length} people: {shown.slice(0, 3).map(x => x.post.author).join(', ')}{people.length > 3 ? ` and ${people.length - 3} more` : ''}</span>
  </div>;
}

/** The reader's full Fedizen handle, lower case, once known. */
export function useMyAcct(): string | undefined {
  const { user } = useAtlasAuth();
  const statusFn = useServerFn(getFedizenStatus);
  const status = useQuery({ queryKey: ['fedizen-status', user?.id], queryFn: () => statusFn(), enabled: !!user, staleTime: 60_000 });
  return fullAcct(status.data?.handle)?.toLowerCase();
}

export function useIsMePost() {
  const me = useMyAcct();
  return (p: FedizenPost) => !!me && fullAcct(p.acct ?? p.handle)?.toLowerCase() === me;
}

/**
 * Keeps the reader's place while a conversation changes under them (replies arriving, edits, placeholders): before
 * the change shows, which post is being read and where; once it shows, scroll by however far that post moved. Done here rather than left to the browser's scroll anchoring, which not every browser has.
 */
export function useScrollAnchor(root: { current: HTMLElement | null }, version: unknown, selector = '[data-status-id]') {
  const snap = useRef<{ k: string; top: number } | null>(null);
  const seen = useRef(version);
  // Read while rendering the new version, before React changes the page.
  if (seen.current !== version) {
    seen.current = version;
    snap.current = null;
    // The post being read: the one across the line 40% down the screen (or the first below it). Changes above it are
    // made up for; changes below it don't move it anyway.
    const line = (typeof window === 'undefined' ? 0 : window.innerHeight) * 0.4;
    for (const el of root.current?.querySelectorAll<HTMLElement>(selector) ?? []) {
      const r = el.getBoundingClientRect();
      if (r.height > 0 && r.bottom > line) { snap.current = { k: el.getAttribute(selector.slice(1, -1)) ?? '', top: r.top }; break; }
    }
  }
  useLayoutEffect(() => {
    const s = snap.current;
    snap.current = null;
    if (!s?.k || !root.current) return;
    const attr = selector.slice(1, -1);
    const el = [...root.current.querySelectorAll<HTMLElement>(selector)].find(x => x.getAttribute(attr) === s.k);
    if (!el) return;
    const moved = el.getBoundingClientRect().top - s.top;
    if (Math.abs(moved) < 1) return;
    const scroller = el.closest<HTMLElement>('.page-content');
    if (scroller) scroller.scrollTop += moved; else window.scrollBy(0, moved);
  }, [version]); // eslint-disable-line react-hooks/exhaustive-deps
}

/** For screen readers, what just arrived ("2 new replies"), since the page itself doesn't move to show it. */
export function ArrivalNote({ arrived, one, many }: { arrived: ReadonlyMap<string, number> | undefined; one: string; many: string }) {
  const latest = Math.max(0, ...(arrived?.values() ?? []));
  const count = latest ? [...arrived!.values()].filter(at => at === latest).length : 0;
  return <p className="sr-only" role="status" aria-live="polite">{count ? (count === 1 ? one : `${count} ${many}`) : ''}</p>;
}

/** Posts added in the last few seconds get a short highlight (styles.css .is-arrived), once. */
export const justArrived = (arrived: ReadonlyMap<string, number> | undefined, k: string, now = Date.now()) => {
  const at = arrived?.get(k);
  return at !== undefined && now - at < 10_000;
};

/**
 * One visit to a conversation: where the reader left off before it (read once, when the conversation is first known
 * on this page, so posts stay marked new for the whole visit) and, once Fedizen has answered, this visit recorded as read up to the newest post shown — again whenever more are shown
 * (new replies wait until the reader asks for them, so they aren't marked read unseen). Kept on this device
 * (conversation.ts, readMarks).
 */
export function useConversationVisit(t: Thread | null, loaded: boolean): number | undefined {
  const root = t ? rootOf(t) : null;
  const rootKey = root ? root.statusId ?? root.id : null;
  const before = useRef<{ root: string; at?: number } | null>(null);
  if (rootKey && before.current?.root !== rootKey) before.current = { root: rootKey, at: readMarks()[rootKey]?.lastRead };
  useEffect(() => {
    if (!t || !root || !rootKey || !loaded) return;
    const at = before.current?.at;
    writeMark(rootKey, { lastRead: Math.max(latestTime(allPosts(t)), at ?? 0), seenAt: Date.now(), opened: t.focus.statusId ?? t.focus.id });
  }, [loaded, rootKey, t]); // eslint-disable-line react-hooks/exhaustive-deps
  return before.current?.at;
}
