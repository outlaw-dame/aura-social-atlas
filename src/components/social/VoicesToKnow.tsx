import { useEffect, useMemo, useState } from 'react';
import { ArrowUpRight, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { NetworkBadge } from '@/lib/networks';
import { useQuery } from '@tanstack/react-query';
import { linkifyHashtags } from '@/lib/hashtags';
import { getVoiceAvatars, getVoices } from '@/lib/voices.functions';
import { categoryOf, podcastVoices, VOICE_CATEGORIES, videoVoices, voices as writers, voicesPage, VOICES_PER_PAGE, type Voice, type VoiceCategory } from '@/lib/voices';
import { parseHandle } from '@/lib/article-author';
import { openFediProfile } from '@/lib/fedi-profile';
import { readKeptPublic, writeKeptPublic } from '@/lib/kept-public';

const DAY = 24 * 3_600_000;

export const compactCount = (n?: number) => (n == null ? null : new Intl.NumberFormat(undefined, { notation: 'compact' }).format(n));
export const VOICE_BLURB: Record<VoiceCategory | 'all', string> = {
  all: 'Writers, podcasters, video channels and the fediverse’s most-followed accounts',
  popular: 'The most-followed accounts across the fediverse, from FediDB',
  writer: 'Writers across Mastodon, Micro.blog and Write.as',
  podcast: 'Podcasts on Castopod, including the Castopod Index’s most popular',
  video: 'Video channels on PeerTube',
};

/**
 * Voices to know, shared by desktop (this file) and the phone (f7/Discover.tsx): real open-web voices six at a time,
 * rotating every 20 s, filtered by kind; "All" interleaves the kinds. Each opens its profile in Atlas.
 */
export function useVoicesToKnow() {
  const [page, setPage] = useState(0);
  const [kind, setKind] = useState<VoiceCategory | 'all'>('all');
  // Opens on this device's copy from the last day (kept-public.ts), then asks the server when it's over an hour old.
  const keptAvatars = useMemo(() => (typeof window === 'undefined' ? null : readKeptPublic<Awaited<ReturnType<typeof getVoiceAvatars>>>('voice-avatars', DAY)), []);
  const keptVoices = useMemo(() => (typeof window === 'undefined' ? null : readKeptPublic<Awaited<ReturnType<typeof getVoices>>>('voices', DAY)), []);
  const { data: avatars } = useQuery({ queryKey: ['voice-avatars'], queryFn: async () => { const r = await getVoiceAvatars(); writeKeptPublic('voice-avatars', r); return r; }, staleTime: 3600_000,
    ...(keptAvatars ? { initialData: keptAvatars.data, initialDataUpdatedAt: keptAvatars.savedAt } : {}) });
  const { data } = useQuery({ queryKey: ['voices'], queryFn: async () => { const r = await getVoices(); writeKeptPublic('voices', r); return r; }, staleTime: 3600_000,
    ...(keptVoices ? { initialData: keptVoices.data, initialDataUpdatedAt: keptVoices.savedAt } : {}) });
  const all: Voice[] = data?.voices ?? [...writers, ...podcastVoices, ...videoVoices];
  const list = useMemo(() => {
    if (kind !== 'all') return all.filter(v => categoryOf(v) === kind);
    const by = (['popular', 'writer', 'podcast', 'video'] as const).map(k => all.filter(v => categoryOf(v) === k));
    const out: Voice[] = [];
    for (let i = 0; by.some(l => i < l.length); i++) for (const l of by) if (l[i]) out.push(l[i]);
    return out;
  }, [all, kind]);
  const pages = Math.max(1, Math.ceil(list.length / VOICES_PER_PAGE));
  useEffect(() => { const t = setInterval(() => setPage(p => p + 1), 20000); return () => clearInterval(t); }, [page]);
  useEffect(() => { setPage(0); }, [kind]);
  const open = (v: Voice) => {
    const h = parseHandle(v.handle);
    if (h) openFediProfile({ acct: h, name: v.name }); else window.open(v.url, '_blank', 'noopener,noreferrer');
  };
  return {
    kind, setKind, page, pages, next: () => setPage(p => p + 1), open,
    voices: voicesPage(page, list).map(v => ({ ...v, avatar: v.avatar ?? avatars?.[v.id] ?? undefined, inAtlas: !!parseHandle(v.handle) })),
    fedidbDown: !!data && kind === 'popular' && !data.sources.fedidb,
  };
}

/** Rotating list of real open-web voices, six at a time; filter by kind. Each opens its profile in Atlas. */
export function VoicesToKnow() {
  const { kind, setKind, page, pages, next: nextPage, open, voices, fedidbDown } = useVoicesToKnow();
  return <div>
    <div role="tablist" aria-label="Kinds of voices" className="mb-3 flex flex-wrap gap-1.5">
      {VOICE_CATEGORIES.map(c => <button key={c.id} type="button" role="tab" aria-selected={kind === c.id} onClick={() => setKind(c.id)}
        className={`rounded-full border px-2.5 py-1 text-[11px] transition-colors ${kind === c.id ? 'border-transparent bg-accent text-accent-foreground' : 'border-border text-muted-foreground hover:text-foreground'}`}>{c.label}</button>)}
    </div>
    <div className="mb-5 flex items-center justify-between gap-2">
      <p className="text-[11px] text-muted-foreground">{VOICE_BLURB[kind]}</p>
      <Button variant="ghost" size="sm" className="h-7 shrink-0 gap-1 rounded-full px-2 text-[11px]" onClick={nextPage} aria-label="Show more voices"><RefreshCw className="size-3" />{(page % pages) + 1}/{pages}</Button>
    </div>
    <ul className="space-y-5">{voices.map(v => {
      const avatar = v.avatar;
      return <li key={v.id} className="border-b border-border pb-5 animate-in fade-in duration-500">
        <button type="button" onClick={() => open(v)} className="group flex w-full items-start gap-3 text-left" aria-label={`${v.name} on ${v.network}`}>
          {avatar ? <img className="size-10 shrink-0 atlas-avatar object-cover ring-1 ring-border" src={avatar} alt="" width={40} height={40} loading="lazy" referrerPolicy="no-referrer" /> : <span className="flex size-10 shrink-0 items-center justify-center atlas-avatar bg-muted font-serif text-sm ring-1 ring-border" aria-hidden="true">{v.name.split(/\s+/).filter(w => /^[A-Z]/.test(w)).slice(0, 2).map(w => w[0]).join('') || v.name.charAt(0)}</span>}
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-1 text-xs font-semibold group-hover:underline">{v.name}{!v.inAtlas && <ArrowUpRight className="size-3 text-muted-foreground" />}</span>
            <span className="block truncate text-[10px] text-muted-foreground">{v.handle}</span>
            <span className="mt-1 flex items-center gap-1 text-[10px] text-muted-foreground"><NetworkBadge network={v.network} /> · {compactCount(v.followers) ? `${compactCount(v.followers)} followers` : v.topic}</span>
          </span>
        </button>
        {v.bio && <p className="mt-2 pl-[52px] text-xs leading-relaxed text-muted-foreground">{linkifyHashtags(v.bio)}</p>}
      </li>;
    })}</ul>
    {fedidbDown && <p className="text-[11px] text-muted-foreground">FediDB couldn’t be reached; try again later.</p>}
  </div>;
}
