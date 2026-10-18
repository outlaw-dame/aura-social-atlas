import { useEffect, useRef, useState } from 'react';
import { Check, Copy, PenLine, Sparkle, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useIsMobile } from '@/hooks/use-mobile';
import { COMPOSE_IDLE_DELAY, isComposeVisible } from '@/lib/compose-policy';
import { AssistantOverlay } from './Assistant';

export function Composer({ assistantEnabled, onNavigate }: { assistantEnabled: boolean; onNavigate: (url: string) => void }) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<'write' | 'assistant'>('write');
  const [scrolling, setScrolling] = useState(false);
  const [draft, setDraft] = useState('');
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const mobile = useIsMobile();
  const assistant = mode === 'assistant' && assistantEnabled;
  const close = () => { setOpen(false); triggerRef.current?.focus(); };
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const onScroll = () => { setScrolling(true); clearTimeout(timer); timer = setTimeout(() => setScrolling(false), COMPOSE_IDLE_DELAY); };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => { window.removeEventListener('scroll', onScroll); clearTimeout(timer); };
  }, []);
  useEffect(() => { if (open && !assistant) inputRef.current?.focus(); }, [open, assistant]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(false); triggerRef.current?.focus(); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);
  const visible = isComposeVisible(mobile, scrolling, open);
  return <>
    <Button ref={triggerRef} size="icon" aria-label={open ? 'Close composer' : 'Open composer'} aria-expanded={open} title="Compose" onClick={() => { if (open) close(); else { setMode('write'); setOpen(true); } }} className={`fixed bottom-5 right-5 z-50 size-12 rounded-full border border-border shadow-lg transition duration-300 motion-reduce:transition-none sm:hidden ${visible ? 'opacity-100' : 'pointer-events-none translate-y-6 opacity-0'}`} tabIndex={visible ? 0 : -1}><PenLine className="size-5" /></Button>
    {open && !assistant && <section role="dialog" aria-label="Compose" className="fixed bottom-24 right-4 z-50 w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-border bg-card text-card-foreground shadow-2xl sm:hidden">
      <div className="flex items-center justify-between border-b border-border px-4 py-3"><h2 className="flex items-center gap-2 text-sm font-semibold"><PenLine className="size-4" />Compose</h2><Button variant="ghost" size="icon" aria-label="Close compose panel" onClick={close}><X /></Button></div>
      <div className="p-4"><label htmlFor="compose-draft" className="sr-only">Your draft</label><textarea ref={inputRef} id="compose-draft" value={draft} onChange={e => { setDraft(e.target.value); setCopied(false); setCopyError(false); }} placeholder="What’s on your mind?" className="h-36 max-h-[calc(100dvh-20rem)] w-full resize-none bg-transparent text-sm leading-relaxed outline-none placeholder:text-muted-foreground" /><p className="text-xs text-muted-foreground">Draft only · no social account connected</p>{copyError && <p role="alert" className="mt-2 text-xs text-destructive">Couldn’t copy. Select your draft and copy it manually.</p>}</div>
      <div className="flex items-center justify-between gap-3 border-t border-border p-3">{assistantEnabled ? <Button variant="ghost" size="sm" onClick={() => setMode('assistant')}><Sparkle />Ask Atlas</Button> : <span className="text-xs text-muted-foreground">Private draft</span>}<Button size="sm" disabled={!draft.trim()} onClick={async () => { try { await navigator.clipboard.writeText(draft); setCopied(true); } catch { setCopyError(true); } }}>{copied ? <Check /> : <Copy />}{copied ? 'Copied' : 'Copy draft'}</Button></div>
    </section>}
    {assistantEnabled && <AssistantOverlay open={open && assistant} onOpenChange={v => { if (!v) close(); }} onNavigate={onNavigate} showLauncher={false} onCompose={() => setMode('write')} />}
  </>;
}