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

export type Audience = 'public' | 'unlisted' | 'private' | 'direct';
export const AUDIENCES: { id: Audience; label: string; note: string }[] = [
  { id: 'public', label: 'Public', note: 'Anyone, on and off the fediverse' },
  { id: 'unlisted', label: 'Quiet public', note: 'Anyone, but kept out of public timelines and search' },
  { id: 'private', label: 'Followers', note: 'Only people who follow you' },
  { id: 'direct', label: 'Mentioned people', note: 'Only the people you @mention' },
];

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
  const setQuote = (q: FedizenPost | null) => { setQuoteRaw(q); if (q && audience !== 'public' && audience !== 'unlisted') setAudienceRaw('public'); };
  const setAudience = (a: Audience) => { if (!quote || a === 'public' || a === 'unlisted') setAudienceRaw(a); };
  const [sensitiveChoice, setSensitive] = useState(false);
  const [quotePolicy, setQuotePolicyRaw] = useState<QuotePolicy>(savedQuotePolicy);
  const setQuotePolicy = (q: QuotePolicy) => { setQuotePolicyRaw(q); saveQuotePolicy(q); };
  const [media, setMedia] = useState<Attachment[]>([]);
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
  const viaGraph = (audience === 'public' || audience === 'unlisted') && (!!quote || !sensitiveOnly);
  /** Why who-may-quote can't be chosen for this post, if it can't. Followers-only and mentions-only posts can't be quoted (as on Mastodon). */
  const quoteLock: 'private' | 'sensitive' | null = audience === 'private' || audience === 'direct' ? 'private' : viaGraph ? null : 'sensitive';

  const add = (files: FileList | File[]) => {
    setNotice(null);
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
  const ready = canPost && !sending && !busy && !broken && (text.trim().length > 0 || media.length > 0) && length <= limits.maxChars && (!cwOn || warning.length > 0);

  const reset = () => { media.forEach(m => { if (m.file) URL.revokeObjectURL(m.url); }); setText(''); setCw(''); setCwOn(false); setSensitive(false); setMedia([]); setNotice(null); setAudienceRaw('public'); setQuoteRaw(null); };

  const send = async (): Promise<{ url?: string } | null> => {
    if (!user || !ready) return null;
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
      const r = viaGraph && (audience === 'public' || audience === 'unlisted')
        ? await createFn({ data: { expectedAtlasUserId: user.id, ...(quote?.statusId ? { quoteId: quote.statusId } : {}), text: text.trim(), visibility: audience, ...(warning ? { cw: warning.slice(0, MAX_CW) } : {}), mediaIds: ids, quotes: quotePolicy } })
          .catch(() => ({ ok: false as const, error: 'unavailable' as const }))
        : await post({ data: { expectedAtlasUserId: user.id, text: text.trim(), visibility: audience, ...(warning ? { cw: warning.slice(0, MAX_CW) } : {}), mediaIds: ids, sensitive } })
          .catch(() => ({ ok: false as const, error: 'unavailable' as const }));
      if (!r.ok) { setNotice(LIBRARY_PROBLEM[r.error]); return null; }
      reset();
      void qc.invalidateQueries({ queryKey: ['fedizen-home', user.id] });
      return { url: r.url };
    } finally { setSending(false); }
  };

  return {
    signedIn: !!user, canPost, connected: !!status.data?.connected, limits,
    text, setText, cw, setCw, cwOn, setCwOn, audience, setAudience, quote, setQuote,
    audiences: quote ? AUDIENCES.filter(a => a.id === 'public' || a.id === 'unlisted') : AUDIENCES,
    sensitive, sensitiveLocked: media.length > 0 && warning.length > 0, setSensitive,
    media, add, addGif, gifs: gifsQ.data?.enabled === true, remove, setAlt, generateAlt, canGenerateAlt: ai.ready,
    quotePolicy, setQuotePolicy, quotePolicies: QUOTE_POLICIES, quoteLock,
    notice, clearNotice: () => setNotice(null), sending, ready, length, reset, send,
  };
}
