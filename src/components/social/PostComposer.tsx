import { useRef, useState } from 'react';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { missingAlt, useReading } from '@/lib/reading-prefs';
import { AtSign, Globe2, ImagePlus, Loader2, Lock, MoonStar, Sparkles, TriangleAlert, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { MAX_ALT, MAX_CW, PICKER_ACCEPT, altReminderText } from '@/lib/compose-media';
import { AUDIENCES, usePublish, type Audience } from './usePublish';

const AUDIENCE_ICON: Record<Audience, typeof Globe2> = { public: Globe2, unlisted: MoonStar, private: Lock, direct: AtSign };

/**
 * Desktop: writing a new post for Fedizen — text, an optional content warning, an audience, and up to 4 images or one
 * video, each with alt text, and whether the media is sensitive (on, and fixed, while there's a content warning, as
 * Mastodon does). See usePublish.
 */
export function PostComposer({ publish, onPosted, inputRef }: { publish: ReturnType<typeof usePublish>; onPosted: (url?: string) => void; inputRef?: React.RefObject<HTMLTextAreaElement | null> }) {
  const p = publish;
  const pick = useRef<HTMLInputElement>(null);
  const over = p.length > p.limits.maxChars;
  const prefs = useReading();
  const [asking, setAsking] = useState(false);
  const altFields = useRef(new Map<string, HTMLInputElement>());
  const post = async () => { const r = await p.send(); if (r) onPosted(r.url); };
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
      <textarea ref={inputRef} id="compose-post" value={p.text} onChange={e => p.setText(e.target.value)} placeholder="What’s on your mind?"
        onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void send(); } }}
        className="h-32 w-full resize-none bg-transparent text-sm leading-relaxed outline-none placeholder:text-muted-foreground" />
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
                {m.kind === 'image' && p.canGenerateAlt && <Button type="button" variant="ghost" size="icon" className="size-7 shrink-0" disabled={p.sending || m.describing || m.state === 'preparing'} onClick={() => void p.generateAlt(m.key)}
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
      {p.notice && <p role="alert" className="text-xs text-destructive">{p.notice}</p>}
    </div>
    <div className="flex items-center gap-1 border-t border-border p-2">
      <input ref={pick} type="file" accept={PICKER_ACCEPT} multiple hidden onChange={e => { if (e.target.files) p.add(e.target.files); e.target.value = ''; }} />
      <Button variant="ghost" size="icon" aria-label="Add images or a video" title="Add images or a video" disabled={p.sending} onClick={() => pick.current?.click()}><ImagePlus /></Button>
      <Button variant="ghost" size="icon" aria-label="Content warning" title="Content warning" aria-pressed={p.cwOn} disabled={p.sending} onClick={() => p.setCwOn(!p.cwOn)} className={p.cwOn ? 'bg-amber-500/15 text-amber-700 hover:bg-amber-500/25 dark:text-amber-400' : ''}><TriangleAlert /></Button>
      <Select value={p.audience} onValueChange={v => p.setAudience(v as Audience)} disabled={p.sending}>
        <SelectTrigger aria-label="Who can see it" className="h-8 w-auto gap-1.5 border-0 bg-transparent px-2 text-xs shadow-none">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>{AUDIENCES.map(a => { const I = AUDIENCE_ICON[a.id]; return <SelectItem key={a.id} value={a.id}><span className="flex items-center gap-2"><I className="size-3.5" />{a.label}</span></SelectItem>; })}</SelectContent>
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
