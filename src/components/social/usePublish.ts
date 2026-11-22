import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { attachGifOnFedizen, createPostOnFedizen, getFedizenComposeLimits, getFedizenStatus, getGifsEnabled, postOnFedizen, uploadFedizenMedia } from '@/lib/fedizen.functions';
import type { Gif } from '@/lib/klipy.server';
import { QUOTE_POLICIES, saveQuotePolicy, savedQuotePolicy, type QuotePolicy } from '@/lib/quote-policy';
import type { FedizenPost } from '@/lib/fedizen-feed';
import { DEFAULT_LIMITS, MAX_ALT, MAX_CW, canAdd, effectiveSensitive, formatBytes, mediaKind } from '@/lib/compose-media';
import { ImageTooLarge, describable, prepareImage } from '@/lib/prepare-image';
import { useAtlasAuth } from './AuthState';
import { LIBRARY_PROBLEM } from './useFedizenLibrary';
import { AI_PROBLEM, useAiRunner } from './useIntelligence';

export type Audience = 'public' | 'unlisted' | 'local' | 'private' | 'direct';
export const AUDIENCES: { id: Audience; label: string; note: string }[] = [
  { id: 'public', label: 'Public', note: 'Anyone, on and off the fediverse' },
  { id: 'unlisted', label: 'Quiet public', note: 'Anyone, but kept out of public timelines and search' },
  // Bonfire's "local" boundary (bonfire_boundaries runtime_config.ex `preset_acls`): only people signed in to Fedizen can read and reply.
  { id: 'local', label: 'Fedizen only', note: 'Only people with a Fedizen account' },
  { id: 'private', label: 'Followers', note: 'Only people who follow you' },
  { id: 'direct', label: 'Mentioned people', note: 'Only the people you @mention' },
];

/** Audiences a quote can go to, through GraphQL `createPost`; Followers and Mentioned people posts can't quote or be quoted. */
const QUOTABLE: ReadonlySet<Audience> = new Set(['public', 'unlisted', 'local']);
export const LOCAL_SENSITIVE = 'On a Fedizen-only post, add a content warning to mark media sensitive.';

export type Attachment = {
  /** A file the person picked; absent for a GIF from the picker, which the server fetches (`gif`). */
  key: string; file?: File; gif?: { slug: string }; kind: 'image' | 'video'; url: string; alt: string; /** Alt text is being written by the AI model. */ describing?: boolean;
  state: 'preparing' | 'ready' | 'uploading' | 'uploaded' | 'failed'; mediaId?: string; error?: string;
};

const UPLOAD_PROBLEM = {
  'too-large': 'This file is larger than Fedizen takes.', unsupported: 'Fedizen doesn’t take this kind of file.',
  'not-configured': 'GIFs aren’t available right now.', busy: 'The GIF service is busy. Try again in a moment.',
} as const;
let seq = 0;

/**
 * A new post on Fedizen: text, content warning, audience, and up to 4 images or one video with alt text and a
 * sensitive mark (lib/compose-media has the rules and their sources). Images are prepared in the browser
 * (lib/prepare-image); files are uploaded when the post is sent, so nothing is left on Fedizen if it isn't, and an
 * upload that already worked isn't repeated when sending is tried again.
 */
/** A poll being composed. */
export type ComposePoll = { options: string[]; expiresIn: number; multiple: boolean };
/** How long a poll runs, as Mastodon offers it (5 minutes to 7 days). */
export const POLL_DURATIONS = [
  { seconds: 300, label: '5 minutes' }, { seconds: 1800, label: '30 minutes' }, { seconds: 3600, label: '1 hour' },
  { seconds: 21_600, label: '6 hours' }, { seconds: 43_200, label: '12 hours' }, { seconds: 86_400, label: '1 day' },
  { seconds: 259_200, label: '3 days' }, { seconds: 604_800, label: '7 days' },
] as const;
export const MAX_POLL_OPTIONS = 4;

export function usePublish() {
  const { user } = useAtlasAuth();
  const qc = useQueryClient();
  const statusFn = useServerFn(getFedizenStatus), limitsFn = useServerFn(getFedizenComposeLimits);
  const upload = useServerFn(uploadFedizenMedia), post = useServerFn(postOnFedizen), createFn = useServerFn(createPostOnFedizen), attachGif = useServerFn(attachGifOnFedizen);
  const gifsFn = useServerFn(getGifsEnabled);
  const status = useQuery({ queryKey: ['fedizen-status', user?.id], queryFn: () => statusFn(), enabled: !!user, staleTime: 60_000 });
  const canPost = !!status.data?.connected && !!status.data?.canWrite;
  const limitsQ = useQuery({ queryKey: ['fedizen-compose-limits', user?.id], queryFn: () => limitsFn({ data: { expectedAtlasUserId: user!.id } }), enabled: !!user && canPost, staleTime: 3_600_000 });
  const limits = limitsQ.data ?? DEFAULT_LIMITS;
  const gifsQ = useQuery({ queryKey: ['gifs-enabled'], queryFn: () => gifsFn(), enabled: !!user && canPost, staleTime: 3_600_000 });

  const [text, setText] = useState('');
  const [cw, setCw] = useState('');
  const [cwOn, setCwOn] = useState(false);
  const [audience, setAudienceRaw] = useState<Audience>('public');
  /** The post being quoted (Boost → Quote), shown under the text; quotes are Public or Quiet public only. */
  const [quote, setQuoteRaw] = useState<FedizenPost | null>(null);
  const setQuote = (q: FedizenPost | null) => { setQuoteRaw(q); if (q) setPollRaw(null); if (q && !QUOTABLE.has(audience)) setAudienceRaw('public'); };
  const setAudience = (a: Audience) => { if ((!quote || QUOTABLE.has(a)) && !(poll && a === 'local')) setAudienceRaw(a); };
  const [sensitiveChoice, setSensitive] = useState(false);
  const [quotePolicy, setQuotePolicyRaw] = useState<QuotePolicy>(savedQuotePolicy);
  const setQuotePolicy = (q: QuotePolicy) => { setQuotePolicyRaw(q); saveQuotePolicy(q); };
  const [media, setMedia] = useState<Attachment[]>([]);
  /** A poll, as Mastodon composes one: 2 to 4 choices, how long it runs, one choice or several. No media alongside. */
  const [poll, setPollRaw] = useState<ComposePoll | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const ai = useAiRunner();
  const mediaRef = useRef(media); mediaRef.current = media;
  useEffect(() => () => mediaRef.current.forEach(m => { if (m.file) URL.revokeObjectURL(m.url); }), []);

  const patch = (key: string, p: Partial<Attachment>) => setMedia(ms => ms.map(m => (m.key === key ? { ...m, ...p } : m)));
  const warning = cwOn ? cw.trim() : '';
  const sensitive = effectiveSensitive(warning, media.length > 0, sensitiveChoice);
  // Who may quote goes through GraphQL createPost, which has no sensitive mark of its own: a post whose media is marked
  // sensitive without a content warning goes through REST, which keeps the mark, and Fedizen's default applies.
  const sensitiveOnly = sensitive && !warning;
  // A poll goes through REST: Fedizen's createPoll takes no quote permissions, so its quoting follows Fedizen's default.
  // Fedizen only exists only in GraphQL (REST's visibilities have no "local"), so such a post always goes that way: it
  // takes no poll, and media marked sensitive needs a content warning (see `send`).
  const viaGraph = audience === 'local' || (!poll && QUOTABLE.has(audience) && (!!quote || !sensitiveOnly));
  /** Why who-may-quote can't be chosen for this post, if it can't. Followers-only and mentions-only posts can't be quoted (as on Mastodon). */
  const quoteLock: 'private' | 'sensitive' | 'poll' | null = audience === 'private' || audience === 'direct' ? 'private' : viaGraph ? null : poll ? 'poll' : 'sensitive';
  const pollChoices = poll ? poll.options.map(o => o.trim()) : [];
  const pollValid = !poll || (pollChoices.every(Boolean) && pollChoices.length >= 2 && new Set(pollChoices.map(o => o.toLowerCase())).size === pollChoices.length);

  const add = (files: FileList | File[]) => {
    setNotice(null);
    if (poll) { setNotice('A post with a poll can’t have images or video.'); return; }
    const kinds = mediaRef.current.map(m => m.kind);
    for (const file of Array.from(files)) {
      const kind = mediaKind(file.type);
      if (!kind) { setNotice(`${file.name || 'That file'} isn’t an image, MP4 or WebM video.`); continue; }
      const why = canAdd(kinds, kind);
      if (why) { setNotice(why); break; }
      if (kind === 'video' && file.size > limits.videoBytes) { setNotice(`Videos can be up to ${formatBytes(limits.videoBytes)}.`); continue; }
      kinds.push(kind);
      const a: Attachment = { key: `m${++seq}`, file, kind, url: URL.createObjectURL(file), alt: '', state: kind === 'image' ? 'preparing' : 'ready' };
      setMedia(ms => [...ms, a]);
      if (kind === 'image') {
        prepareImage(file, limits.imageBytes)
          .then(ready => patch(a.key, { file: ready, state: 'ready' }))
          .catch(e => patch(a.key, { state: 'failed', error: e instanceof ImageTooLarge ? `Too large: images can be up to ${formatBytes(limits.imageBytes)}.` : 'This image couldn’t be read.' }));
      }
    }
  };
  /** A GIF from the picker (KLIPY): shown from its preview now, fetched and uploaded by the server when the post is sent. Its title starts the alt text. */
  const addGif = (g: Gif) => {
    setNotice(null);
    if (poll) { setNotice('A post with a poll can’t have a GIF.'); return false; }
    const why = canAdd(mediaRef.current.map(m => m.kind), 'image');
    if (why) { setNotice(why); return false; }
    setMedia(ms => [...ms, { key: `m${++seq}`, gif: { slug: g.slug }, kind: 'image', url: g.preview.url, alt: g.title.slice(0, MAX_ALT), state: 'ready' }]);
    return true;
  };
  const remove = (key: string) => setMedia(ms => { const m = ms.find(x => x.key === key); if (m?.file) URL.revokeObjectURL(m.url); return ms.filter(x => x.key !== key); });
  const setAlt = (key: string, alt: string) => patch(key, { alt: alt.slice(0, MAX_ALT), mediaId: undefined, state: 'ready' });
  /** Alt text written by the person's AI model (Settings → Intelligence), which they can then edit. Images only. */
  const generateAlt = async (key: string) => {
    const m = mediaRef.current.find(x => x.key === key);
    if (!m?.file || m.kind !== 'image' || m.describing || !ai.ready) return;
    patch(key, { describing: true, error: undefined });
    try {
      const image = await describable(m.file);
      const r = await ai.altText(image, text);
      if ('error' in r) patch(key, { describing: false, error: AI_PROBLEM[r.error] });
      else patch(key, { describing: false, alt: r.alt.slice(0, MAX_ALT), mediaId: undefined, state: 'ready' });
    } catch {
      patch(key, { describing: false, error: 'This image couldn’t be read.' });
    }
  };

  const busy = media.some(m => m.state === 'preparing' || m.describing);
  const broken = media.some(m => m.state === 'failed');
  const length = [...text].length;
  const ready = canPost && !sending && !busy && !broken && (text.trim().length > 0 || media.length > 0 || !!poll) && pollValid && length <= limits.maxChars && (!cwOn || warning.length > 0);
  const startPoll = () => { if (media.length || quote || audience === 'local') return; setPollRaw({ options: ['', ''], expiresIn: POLL_DURATIONS[5].seconds, multiple: false }); };
  const editPoll = (p: Partial<ComposePoll>) => setPollRaw(cur => (cur ? { ...cur, ...p } : cur));

  const reset = () => { media.forEach(m => { if (m.file) URL.revokeObjectURL(m.url); }); setText(''); setCw(''); setCwOn(false); setSensitive(false); setMedia([]); setNotice(null); setAudienceRaw('public'); setQuoteRaw(null); setPollRaw(null); };

  const send = async (): Promise<{ url?: string; id?: string } | null> => {
    if (!user || !ready) return null;
    if (audience === 'local' && sensitiveOnly) { setNotice(LOCAL_SENSITIVE); return null; }
    setSending(true); setNotice(null);
    try {
      const ids: string[] = [];
      for (const m of mediaRef.current) {
        if (m.mediaId) { ids.push(m.mediaId); continue; }
        patch(m.key, { state: 'uploading', error: undefined });
        let r: { ok: true; id: string } | { ok: false; error: string };
        if (m.gif) {
          r = await attachGif({ data: { expectedAtlasUserId: user.id, slug: m.gif.slug, description: m.alt.trim() } }).catch(() => ({ ok: false as const, error: 'unavailable' as const }));
        } else if (m.file) {
          const form = new FormData();
          form.set('expectedAtlasUserId', user.id);
          form.set('description', m.alt.trim());
          form.set('file', m.file, m.file.name);
          r = await upload({ data: form }).catch(() => ({ ok: false as const, error: 'unavailable' as const }));
        } else continue;
        if (!r.ok) {
          const msg = r.error in UPLOAD_PROBLEM ? UPLOAD_PROBLEM[r.error as keyof typeof UPLOAD_PROBLEM] : LIBRARY_PROBLEM[r.error as keyof typeof LIBRARY_PROBLEM];
          // The file is still good: Post tries it again.
          patch(m.key, { state: 'ready', error: msg });
          setNotice(msg);
          return null;
        }
        patch(m.key, { state: 'uploaded', mediaId: r.id });
        ids.push(r.id);
      }
      const r = viaGraph && QUOTABLE.has(audience)
        ? await createFn({ data: { expectedAtlasUserId: user.id, ...(quote?.statusId ? { quoteId: quote.statusId } : {}), text: text.trim(), visibility: audience, ...(warning ? { cw: warning.slice(0, MAX_CW) } : {}), mediaIds: ids, quotes: quotePolicy } })
          .catch(() => ({ ok: false as const, error: 'unavailable' as const }))
        : await post({ data: { expectedAtlasUserId: user.id, text: text.trim(), visibility: audience, ...(warning ? { cw: warning.slice(0, MAX_CW) } : {}), mediaIds: ids, sensitive, ...(poll ? { poll: { options: pollChoices, expiresIn: poll.expiresIn, multiple: poll.multiple } } : {}) } })
          .catch(() => ({ ok: false as const, error: 'unavailable' as const }));
      if (!r.ok) { setNotice(LIBRARY_PROBLEM[r.error]); return null; }
      reset();
      void qc.invalidateQueries({ queryKey: ['fedizen-home', user.id] });
      void qc.invalidateQueries({ queryKey: ['fedizen-recent-tags', user.id] });
      return { url: r.url, ...('id' in r && r.id ? { id: r.id } : {}) };
    } finally { setSending(false); }
  };

  return {
    signedIn: !!user, canPost, connected: !!status.data?.connected, limits,
    text, setText, cw, setCw, cwOn, setCwOn, audience, setAudience, quote, setQuote,
    audiences: AUDIENCES.filter(a => (!quote || QUOTABLE.has(a.id)) && !(poll && a.id === 'local')),
    sensitive, sensitiveLocked: media.length > 0 && warning.length > 0, setSensitive,
    media, add, addGif, gifs: gifsQ.data?.enabled === true, remove, setAlt, generateAlt, canGenerateAlt: ai.ready,
    quotePolicy, setQuotePolicy, quotePolicies: QUOTE_POLICIES, quoteLock,
    notice, clearNotice: () => setNotice(null), sending, ready, length, reset, send,
    poll, startPoll, editPoll, removePoll: () => setPollRaw(null), canPoll: !media.length && !quote && audience !== 'local', pollDurations: POLL_DURATIONS, pollValid,
  };
}
