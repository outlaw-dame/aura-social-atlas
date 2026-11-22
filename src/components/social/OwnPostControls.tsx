import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { MAX_CW, MAX_TEXT } from '@/lib/compose-media';
import { useDeletePost, useEditPost } from './useOwnPosts';

/**
 * Desktop: edit one of your posts, as Mastodon does it: the composer opens with the post's own text and content
 * warning (its source), and saving replaces both; the post then shows "Edited". Media and audience stay as posted
 * (Fedizen's edit takes text and warning only).
 */
export function EditPostDialog({ statusId, onClose }: { statusId: string | null; onClose: () => void }) {
  const e = useEditPost(statusId);
  const [text, setText] = useState(''), [cw, setCw] = useState(''), [cwOn, setCwOn] = useState(false);
  useEffect(() => { if (e.text !== undefined) { setText(e.text); setCw(e.cw ?? ''); setCwOn(!!e.cw); } }, [e.text, e.cw]);
  const save = async () => { if (await e.save(text, cwOn ? cw : '')) onClose(); };
  const empty = !text.trim() && !(cwOn && cw.trim());
  return <Dialog open={!!statusId} onOpenChange={o => { if (!o) onClose(); }}>
    <DialogContent className="sm:max-w-lg">
      <DialogHeader>
        <DialogTitle>Edit post</DialogTitle>
        <DialogDescription>People who saw it will see that it was edited. Images and who can see it stay as posted.</DialogDescription>
      </DialogHeader>
      {e.loading ? <p className="text-sm text-muted-foreground">Loading your post…</p>
        : e.loadError ? <p role="alert" className="text-sm text-destructive">{e.loadError}</p>
        : <>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={cwOn} onChange={ev => setCwOn(ev.target.checked)} />Content warning</label>
          {cwOn && <Input value={cw} onChange={ev => setCw(ev.target.value)} maxLength={MAX_CW} placeholder="What’s it about?" aria-label="Content warning" />}
          <Textarea value={text} onChange={ev => setText(ev.target.value)} maxLength={MAX_TEXT} rows={7} aria-label="Your post" autoFocus />
        </>}
      {e.error && <p role="alert" className="text-sm text-destructive">{e.error}</p>}
      <DialogFooter>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button onClick={() => void save()} disabled={e.loading || !!e.loadError || empty || e.saving}>{e.saving ? 'Saving…' : 'Save'}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}

/** Desktop: confirm before deleting one of your posts, as Mastodon does: it can't be undone. */
export function DeletePostDialog({ statusId, onClose }: { statusId: string | null; onClose: () => void }) {
  const d = useDeletePost();
  return <AlertDialog open={!!statusId} onOpenChange={o => { if (!o) onClose(); }}>
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>Delete this post?</AlertDialogTitle>
        <AlertDialogDescription>It’s removed from Fedizen and from the servers it reached. This can’t be undone.</AlertDialogDescription>
      </AlertDialogHeader>
      {d.error && <p role="alert" className="text-sm text-destructive">{d.error}</p>}
      <AlertDialogFooter>
        <AlertDialogCancel>Cancel</AlertDialogCancel>
        <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" disabled={d.busy}
          onClick={async ev => { ev.preventDefault(); if (statusId && await d.remove(statusId)) onClose(); }}>{d.busy ? 'Deleting…' : 'Delete'}</AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>;
}
