import { useRef, useState } from 'react';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { missingAlt, useReading } from '@/lib/reading-prefs';
import { AtSign, BarChart3, CircleDot, Globe2, House, ImagePlus, Loader2, Lock, MoonStar, Plus, Quote, Sparkles, TriangleAlert, X } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import type { QuotePolicy } from '@/lib/quote-policy';
import { GifPicker } from './GifPicker';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { MAX_ALT, MAX_CW, PICKER_ACCEPT, altReminderText } from '@/lib/compose-media';
import { MAX_POLL_OPTIONS, usePublish, type Audience } from './usePublish';
import { QuotedPost } from './QuotedPost';
import { HashtagSuggestions } from './HashtagSuggestions';
import { MentionSuggestions } from './MentionSuggestions';

const composeField = () => document.getElementById('compose-post') as HTMLTextAreaElement | null;

const AUDIENCE_ICON: Record<Audience, typeof Globe2> = { public: Globe2, unlisted: MoonStar, local: House, private: Lock, circle: CircleDot, direct: AtSign };

/**
 * Desktop: writing a new post for Fedizen — text, an optional content warning, an audience, and up to 4 images or one
 * video, each with alt text, and whether the media is sensitive (on, and fixed, while there's a content warning, as
 * Mastodon does). See usePublish.
 */
export function PostComposer({ publish, onPosted, inputRef }: { publish: ReturnType<typeof usePublish>; onPosted: (posted: { url?: string; id?: string; note?: string }) => void; inputRef?: React.RefObject<HTMLTextAreaElement | null> }) {
  const p = publish;
  const pick = useRef<HTMLInputElement>(null);
  const over = p.length > p.limits.maxChars;
  const prefs = useReading();
  const [asking, setAsking] = useState(false);
  const [gifOpen, setGifOpen] = useState(false);
  const gifFull = p.media.some(m => m.kind === 'video') || p.media.length >= 4;
  const altFields = useRef(new Map<string, HTMLInputElement>());
  const post = async () => { const r = await p.send(); if (r) onPosted(r); };
  // Alt text reminder (Settings → Posting): ask before media goes out undescribed.
  const send = async () => { if (!p.ready || over) return; if (missingAlt(prefs, p.media).length) setAsking(true); else await post(); };
  const lacking = missingAlt(prefs, p.media);
  const words = altReminderText(lacking.length, p.media.length);
  return <div className="flex max-h-[calc(100dvh-12rem)] flex-col">
    <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
      {p.cwOn && <label className="block">
        <span className="sr-only">Content warning</span>
        <input value={p.cw} onChange={e => p.setCw(e.target.value)} maxLength={MAX_CW} placeholder="Content warning: what it’s about" autoFocus
          className="w-full rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring" />
      </label>}
      <label htmlFor="compose-post" className="sr-only">Your post</label>
      <textarea ref={inputRef} id="compose-post" value={p.text} onChange={e => p.setText(e.target.value)} placeholder={p.quote ? 'Add your thoughts' : 'What’s on your mind?'}
        onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void send(); } }}
        className={`${p.quote ? 'h-20' : 'h-32'} w-full resize-none bg-transparent text-sm leading-relaxed outline-none placeholder:text-muted-foreground`} />
      <MentionSuggestions value={p.text} onChange={p.setText} input={composeField} />
      <HashtagSuggestions value={p.text} onChange={p.setText} input={composeField} />
      {p.quote && <QuotedPost post={p.quote} onRemove={p.sending ? undefined : () => p.setQuote(null)} />}
      {p.media.length > 0 && <ul className={`grid gap-2 ${p.media.length > 1 ? 'grid-cols-2' : 'grid-cols-1'}`} aria-label="Attached media">
        {p.media.map(m => <li key={m.key} className="space-y-1">
          <div className="relative overflow-hidden rounded-xl bg-muted">
            {m.kind === 'video'
              ? <video src={m.url} muted playsInline preload="metadata" className="aspect-video w-full object-cover" />
              : <img src={m.url} alt={m.alt} className={`w-full object-cover ${p.media.length > 1 ? 'aspect-square' : 'max-h-56'}`} />}
            {(m.state === 'preparing' || m.state === 'uploading') && <span className="absolute inset-0 flex items-center justify-center gap-2 bg-black/40 text-xs font-medium text-white"><Loader2 className="size-4 animate-spin" />{m.state === 'preparing' ? 'Preparing…' : 'Uploading…'}</span>}
            <button type="button" onClick={() => p.remove(m.key)} disabled={p.sending} aria-label={`Remove ${m.kind}`} className="absolute right-1.5 top-1.5 flex size-7 items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/75 disabled:opacity-50"><X className="size-4" /></button>
          </div>
          {m.state === 'failed' ? <p role="alert" className="text-xs text-destructive">{m.error}</p>
            : <>
              <div className="flex items-start gap-1">
                <label className="block min-w-0 flex-1"><span className="sr-only">Alt text for this {m.kind}</span>
                  <textarea ref={el => { if (el) altFields.current.set(m.key, el as unknown as HTMLInputElement); else altFields.current.delete(m.key); }} value={m.alt} onChange={e => p.setAlt(m.key, e.target.value)} maxLength={MAX_ALT} disabled={p.sending || m.describing} rows={m.alt.length > 60 ? 3 : 1}
                    placeholder={m.describing ? 'Writing alt text…' : m.kind === 'video' ? 'Describe the video' : 'Describe the image (alt text)'}
                    className="block w-full resize-y rounded-md border border-input bg-background px-2 py-1 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring" />
                </label>
                {m.kind === 'image' && !m.gif && p.canGenerateAlt && <Button type="button" variant="ghost" size="icon" className="size-7 shrink-0" disabled={p.sending || m.describing || m.state === 'preparing'} onClick={() => void p.generateAlt(m.key)}
                  aria-label="Write alt text with AI" title={m.alt ? 'Write it again with AI' : 'Write alt text with AI'}>{m.describing ? <Loader2 className="animate-spin" /> : <Sparkles />}</Button>}
              </div>
              {m.error && <p role="alert" className="text-xs text-destructive">{m.error}</p>}
            </>}
        </li>)}
      </ul>}
      {p.media.length > 0 && <label className="flex items-center gap-2 text-xs text-muted-foreground">
        <Checkbox checked={p.sensitive} disabled={p.sensitiveLocked || p.sending} onCheckedChange={v => p.setSensitive(v === true)} />
        {p.sensitiveLocked ? 'Media is marked sensitive (the post has a content warning)' : 'Mark media as sensitive'}
      </label>}
      {p.poll && <PollEditor p={p} />}
      {p.notice && <p role="alert" className="text-xs text-destructive">{p.notice}</p>}
    </div>
    <div className="flex items-center gap-1 border-t border-border p-2">
      <input ref={pick} type="file" accept={PICKER_ACCEPT} multiple hidden onChange={e => { if (e.target.files) p.add(e.target.files); e.target.value = ''; }} />
      <Button variant="ghost" size="icon" aria-label="Add images or a video" title={p.poll ? 'A post with a poll can’t have media' : 'Add images or a video'} disabled={p.sending || !!p.poll} onClick={() => pick.current?.click()}><ImagePlus /></Button>
      <Button variant="ghost" size="icon" aria-label={p.poll ? 'Remove poll' : 'Add a poll'} aria-pressed={!!p.poll} title={p.poll ? 'Remove poll' : p.canPoll ? 'Add a poll' : 'A poll can’t go with media or a quote'}
        disabled={p.sending || (!p.poll && !p.canPoll)} onClick={() => (p.poll ? p.removePoll() : p.startPoll())} className={p.poll ? 'bg-accent/15 text-accent hover:bg-accent/25' : ''}><BarChart3 /></Button>
      <Button variant="ghost" size="icon" aria-label="Content warning" title="Content warning" aria-pressed={p.cwOn} disabled={p.sending} onClick={() => p.setCwOn(!p.cwOn)} className={p.cwOn ? 'bg-amber-500/15 text-amber-700 hover:bg-amber-500/25 dark:text-amber-400' : ''}><TriangleAlert /></Button>
      {p.gifs && <Popover open={gifOpen} onOpenChange={setGifOpen}>
        <PopoverTrigger asChild>
          <Button variant="ghost" size="icon" aria-label="Add a GIF" title={gifFull ? 'This post has all the media it can take' : 'Add a GIF'} disabled={p.sending || gifFull || !!p.poll}><span className="atlas-gif-glyph" aria-hidden>GIF</span></Button>
        </PopoverTrigger>
        <PopoverContent side="top" align="start" className="w-[22rem] p-0"><GifPicker onPick={g => { if (p.addGif(g)) setGifOpen(false); }} /></PopoverContent>
      </Popover>}
      <Select value={p.audience} onValueChange={v => p.setAudience(v as Audience)} disabled={p.sending}>
        <SelectTrigger aria-label="Who can see it" className="h-8 w-auto gap-1.5 border-0 bg-transparent px-2 text-xs shadow-none">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>{p.audiences.map(a => { const I = AUDIENCE_ICON[a.id]; return <SelectItem key={a.id} value={a.id}><span className="flex items-center gap-2"><I className="size-3.5" />{a.label}</span></SelectItem>; })}</SelectContent>
      </Select>
      {p.audience === 'circle' && p.circles.length > 0 && <Select value={p.circleId ?? undefined} onValueChange={v => p.setCircleId(v)} disabled={p.sending}>
        <SelectTrigger aria-label="Which circle" className="h-8 w-auto max-w-[10rem] gap-1.5 border-0 bg-transparent px-2 text-xs shadow-none"><SelectValue /></SelectTrigger>
        <SelectContent>{p.circles.map(c => <SelectItem key={c.id} value={c.id}>{c.title}</SelectItem>)}</SelectContent>
      </Select>}
      {/* Who may quote (lib/quote-policy). Followers-only and mentions-only posts can't be quoted, as on Mastodon. */}
      <Select value={p.quoteLock === 'private' ? 'nobody' : p.quotePolicy} onValueChange={v => p.setQuotePolicy(v as QuotePolicy)} disabled={p.sending || !!p.quoteLock}>
        <SelectTrigger aria-label="Who can quote it" title={p.quoteLock === 'private' ? 'Followers, circle and mentions-only posts can’t be quoted' : p.quoteLock === 'poll' ? 'Quoting a poll follows your Fedizen default' : p.quoteLock === 'sensitive' ? 'Can’t be set while media is marked sensitive without a content warning' : 'Who can quote it'}
          className="h-8 w-auto gap-1.5 border-0 bg-transparent px-2 text-xs shadow-none">
          <Quote className="size-3.5" /><span>{p.quoteLock === 'sensitive' || p.quoteLock === 'poll' ? 'Default' : (p.quotePolicies.find(q => q.id === (p.quoteLock === 'private' ? 'nobody' : p.quotePolicy))?.short)}</span>
        </SelectTrigger>
        <SelectContent>{p.quotePolicies.map(q => <SelectItem key={q.id} value={q.id}><span className="flex flex-col"><span>{q.label}</span>{q.note && <span className="text-[11px] opacity-70">{q.note}</span>}</span></SelectItem>)}</SelectContent>
      </Select>
      <span className={`ml-auto px-2 text-xs tabular-nums ${over ? 'text-destructive' : 'text-muted-foreground'}`} aria-live="polite">{p.limits.maxChars - p.length}</span>
      <Button size="sm" disabled={!p.ready || over} onClick={() => void send()}>{p.sending ? <><Loader2 className="animate-spin" />Posting…</> : 'Post'}</Button>
    </div>
    <AlertDialog open={asking} onOpenChange={setAsking}>
      <AlertDialogContent>
        <AlertDialogHeader><AlertDialogTitle>{words.title}</AlertDialogTitle><AlertDialogDescription>{words.body}</AlertDialogDescription></AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => { const first = lacking[0]; setTimeout(() => first && altFields.current.get(first.key)?.focus(), 0); }}>{words.add}</AlertDialogCancel>
          <AlertDialogAction onClick={() => void post()}>{words.post}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </div>;
}

/** Desktop: the poll being composed, as Mastodon's: up to four choices, how long it runs, one choice or several. */
function PollEditor({ p }: { p: ReturnType<typeof usePublish> }) {
  const poll = p.poll!;
  const set = (i: number, v: string) => p.editPoll({ options: poll.options.map((o, k) => (k === i ? v.slice(0, 200) : o)) });
  return <fieldset className="space-y-2 rounded-xl border border-border p-3" disabled={p.sending}>
    <legend className="px-1 text-xs font-medium text-muted-foreground">Poll</legend>
    {poll.options.map((o, i) => <div key={i} className="flex items-center gap-2">
      <input value={o} onChange={e => set(i, e.target.value)} maxLength={200} placeholder={`Choice ${i + 1}`} aria-label={`Choice ${i + 1}`}
        className="h-8 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring" />
      {poll.options.length > 2 && <Button type="button" variant="ghost" size="icon" className="size-7" aria-label={`Remove choice ${i + 1}`} onClick={() => p.editPoll({ options: poll.options.filter((_, k) => k !== i) })}><X /></Button>}
    </div>)}
    {!p.pollValid && poll.options.every(o => o.trim()) && <p className="text-xs text-destructive">Each choice needs to be different.</p>}
    <div className="flex flex-wrap items-center gap-2 text-xs">
      {poll.options.length < MAX_POLL_OPTIONS && <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => p.editPoll({ options: [...poll.options, ''] })}><Plus />Add a choice</Button>}
      <Select value={String(poll.expiresIn)} onValueChange={v => p.editPoll({ expiresIn: Number(v) })}>
        <SelectTrigger aria-label="How long the poll runs" className="h-7 w-auto gap-1.5 px-2 text-xs"><SelectValue /></SelectTrigger>
        <SelectContent>{p.pollDurations.map(d => <SelectItem key={d.seconds} value={String(d.seconds)}>{d.label}</SelectItem>)}</SelectContent>
      </Select>
      <label className="flex items-center gap-2"><Checkbox checked={poll.multiple} onCheckedChange={v => p.editPoll({ multiple: v === true })} />Allow several choices</label>
    </div>
  </fieldset>;
}
