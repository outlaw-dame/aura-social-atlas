import { useEffect, useRef, useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { getGifs } from '@/lib/fedizen.functions';
import type { Gif } from '@/lib/klipy.server';

const PROBLEM = { 'not-configured': 'GIFs aren’t available right now.', busy: 'Too many searches just now. Try again in a moment.', unavailable: 'GIFs couldn’t load.' } as const;

/** The browser's language as KLIPY wants it (xx_YY), as Zulip's KLIPY picker does: `Intl.Locale(…).maximize()`. */
function klipyLocale(): string | undefined {
  try {
    const l = new Intl.Locale(navigator.language).maximize();
    return l.language && l.region && /^[a-z]{2}$/.test(l.language) && /^[A-Z]{2}$/.test(l.region) ? `${l.language}_${l.region}` : undefined;
  } catch { return undefined; }
}

/**
 * Search and pick a GIF from KLIPY, for the composer (desktop popover and phone sheet). Trending until something is
 * typed; results in two columns at their own shapes; more as the list nears its end. KLIPY's attribution guidelines
 * ask for "Search KLIPY" in the field and "Powered by KLIPY" by the results.
 */
export function GifPicker({ onPick, autoFocus = true }: { onPick: (g: Gif) => void; autoFocus?: boolean }) {
  const fetchGifs = useServerFn(getGifs);
  const [typed, setTyped] = useState('');
  const [q, setQ] = useState('');
  useEffect(() => { const t = setTimeout(() => setQ(typed.trim()), 350); return () => clearTimeout(t); }, [typed]);
  const locale = useRef(klipyLocale()).current;
  const res = useInfiniteQuery({
    queryKey: ['gifs', q, locale],
    initialPageParam: 1,
    queryFn: async ({ pageParam }) => {
      const r = await fetchGifs({ data: { q, page: pageParam, ...(locale ? { locale } : {}) } });
      if (!r.ok) throw new Error(r.error);
      return { ...r, page: pageParam };
    },
    getNextPageParam: last => (last.hasNext && last.page < 40 ? last.page + 1 : undefined),
    staleTime: 5 * 60_000, retry: false,
  });
  const gifs = res.data?.pages.flatMap(p => p.gifs) ?? [];
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = end.current;
    if (!el || !res.hasNextPage) return;
    const io = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting) && !res.isFetchingNextPage) void res.fetchNextPage(); }, { rootMargin: '300px' });
    io.observe(el);
    return () => io.disconnect();
  }, [res.hasNextPage, res.isFetchingNextPage, gifs.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const error = res.error ? PROBLEM[(res.error.message as keyof typeof PROBLEM)] ?? PROBLEM.unavailable : null;
  // Two columns, each taking the next GIF while it's the shorter one, so the grid keeps the GIFs' own shapes.
  const cols: Gif[][] = [[], []];
  const heights = [0, 0];
  for (const g of gifs) { const i = heights[0] <= heights[1] ? 0 : 1; cols[i].push(g); heights[i] += g.preview.height / g.preview.width; }
  return <div className="atlas-gifs">
    <div className="atlas-gifs-head">
      <input type="search" value={typed} onChange={e => setTyped(e.target.value)} placeholder="Search KLIPY" aria-label="Search GIFs" autoFocus={autoFocus} enterKeyHint="search" maxLength={100} />
      <span className="atlas-gifs-credit">Powered by <b>KLIPY</b></span>
    </div>
    <div className="atlas-gifs-list" aria-busy={res.isFetching} aria-label={q ? `GIFs for ${q}` : 'Trending GIFs'} role="region">
      {error && !gifs.length ? <p role="alert" className="atlas-gifs-note">{error} <button type="button" onClick={() => void res.refetch()}>Try again</button></p>
        : res.isPending ? <p className="atlas-gifs-note">Loading…</p>
        : !gifs.length ? <p className="atlas-gifs-note">No GIFs for “{q}”.</p>
        : <div className="atlas-gifs-cols">{cols.map((c, i) => <div key={i}>{c.map(g =>
          <button key={g.slug} type="button" onClick={() => onPick(g)} aria-label={g.title || 'GIF'} title={g.title}
            style={{ aspectRatio: `${g.preview.width} / ${g.preview.height}` }}>
            <img src={g.preview.url} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" />
          </button>)}</div>)}</div>}
      <div ref={end} />
      {res.isFetchingNextPage && <p className="atlas-gifs-note">Loading…</p>}
    </div>
  </div>;
}
