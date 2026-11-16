import { useEffect, useState } from 'react';
import { MoreHorizontal, EyeOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import type { FilterAction, FilterablePost } from '@/lib/content-filter';
import { useFilterLikeThis } from './useFilterLikeThis';
import { ACTION_LABEL } from './filter-options';
import { useAtlasAuth } from './AuthState';

/** Desktop: the post's More menu, with "Filter posts like this". Signed in only (filters are kept per account). */
export function PostMoreMenu({ post }: { post: FilterablePost }) {
  const { user } = useAtlasAuth();
  const [open, setOpen] = useState(false);
  if (!user) return null;
  return <>
    <DropdownMenu>
      <DropdownMenuTrigger asChild><button type="button" className="inline-flex min-h-9 min-w-9 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground" aria-label="More"><MoreHorizontal className="size-4" /></button></DropdownMenuTrigger>
      <DropdownMenuContent align="end"><DropdownMenuItem onSelect={() => setOpen(true)}><EyeOff />Filter posts like this</DropdownMenuItem></DropdownMenuContent>
    </DropdownMenu>
    {open && <FilterLikeThisDialog post={post} onClose={() => setOpen(false)} />}
  </>;
}

function FilterLikeThisDialog({ post, onClose }: { post: FilterablePost; onClose: () => void }) {
  const f = useFilterLikeThis();
  const [text, setText] = useState(''), [action, setAction] = useState<FilterAction>('hide');
  const [thinking, setThinking] = useState(true), [note, setNote] = useState<string | null>(null), [busy, setBusy] = useState(false);
  useEffect(() => { let live = true; void f.draft(post).then(d => { if (!live) return; setText(t => t || d.text); setNote(d.error ?? null); setThinking(false); }); return () => { live = false; }; }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return <Dialog open onOpenChange={o => { if (!o) onClose(); }}>
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Filter posts like this</DialogTitle>
        <DialogDescription>A word, phrase, #hashtag or topic. You can change it in Settings → Moderation.</DialogDescription>
      </DialogHeader>
      <Input value={text} onChange={e => setText(e.target.value)} maxLength={200} placeholder={thinking ? 'Thinking…' : 'A word, phrase, #hashtag or topic'} aria-label="Filter" autoFocus />
      <select className="h-9 rounded-md border border-input bg-background px-3 text-sm" value={action} onChange={e => setAction(e.target.value as FilterAction)} aria-label="What to do with matching posts">
        {(['hide', 'warn', 'blur'] as const).map(a => <option key={a} value={a}>{ACTION_LABEL[a]}</option>)}
      </select>
      {note && <p role="alert" className="text-sm text-muted-foreground">{note}</p>}
      <DialogFooter>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button disabled={!text.trim() || busy} onClick={async () => { setBusy(true); const err = await f.add(text, action); setBusy(false); if (err) setNote(err); else onClose(); }}>Add filter</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
