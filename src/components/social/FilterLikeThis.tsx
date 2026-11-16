import { useEffect, useState } from 'react';
import { Ellipsis, EyeOff, Link2, Share } from 'lucide-react';
import { sharePost } from './usePostActions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import type { FilterAction, FilterablePost } from '@/lib/content-filter';
import { useFilterLikeThis } from './useFilterLikeThis';
import { ACTION_LABEL } from './filter-options';
import { useAtlasAuth } from './AuthState';

/** Desktop: the post's More menu — Share (or Copy link), and "Filter posts like this" when signed in (filters are kept
 *  per account). */
export function PostMoreMenu({ post }: { post: FilterablePost & { url?: string; author?: string } }) {
  const { user } = useAtlasAuth();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const canShare = typeof navigator !== 'undefined' && !!navigator.share;
  if (!post.url && !user) return null;
  return <>
    <DropdownMenu>
      <DropdownMenuTrigger asChild><button type="button" className="atlas-act-more" aria-label={copied ? 'More, link copied' : 'More'}><Ellipsis aria-hidden="true" />{copied && <span className="text-xs">Link copied</span>}</button></DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {post.url && <DropdownMenuItem onSelect={async () => { if ((await sharePost({ url: post.url!, author: post.author ?? '' })) === 'copied') { setCopied(true); setTimeout(() => setCopied(false), 1500); } }}>{canShare ? <><Share />Share</> : <><Link2 />Copy link</>}</DropdownMenuItem>}
        {user && <DropdownMenuItem onSelect={() => setOpen(true)}><EyeOff />Filter posts like this</DropdownMenuItem>}
      </DropdownMenuContent>
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
