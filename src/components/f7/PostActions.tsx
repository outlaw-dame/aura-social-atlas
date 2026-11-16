import { useEffect, useState } from 'react';
import { Block, Button, Link, Sheet, f7 } from 'framework7-react';
import { MentionField } from '@/components/social/MentionField';
import type { FedizenPost } from '@/lib/fedizen-feed';
import type { useSaveToggle } from '@/components/social/useFedizenLibrary';
import { AUDIENCE_LABEL, replyMention, replyVisibility, sharePost, useReactions, useReply } from '@/components/social/usePostActions';
import { Icon } from './F7Extras';
import { Ellipsis } from 'lucide-react';
import { PostActionBar } from '@/components/social/PostActionBar';
import { useAtlasAuth } from '@/components/social/AuthState';
import { useFilterLikeThis } from '@/components/social/useFilterLikeThis';
import { useIsMe } from '@/components/social/useFediProfile';
import { useDeletePost, useEditPost } from '@/components/social/useOwnPosts';
import { MAX_CW, MAX_TEXT } from '@/lib/compose-media';

type Save = ReturnType<typeof useSaveToggle>;
type Reactions = ReturnType<typeof useReactions>;

/**
 * Phone: the standard post actions — Reply, Boost, Like, Save, and More with Share — laid out and confirmed as on
 * desktop (PostActionBar). Reply, Boost, Like and Save act on Fedizen as the person (signed in, connected); Share works
 * for everyone. A post Fedizen's API can't address (no status id) offers More only.
 */
export function MobilePostActions({ post: p, save, reactions, onReply }: { post: FedizenPost; save: Save; reactions: Reactions; onReply: (p: FedizenPost) => void }) {
  const acts = !!p.statusId && reactions.canAct;
  const like = reactions.state(p, 'like'), boost = reactions.state(p, 'boost');
  const saved = save.isSaved(p);
  const boostable = p.visibility !== 'private' && p.visibility !== 'direct';
  const { user } = useAtlasAuth();
  const like_ = useFilterLikeThis();
  /** "Filter posts like this": a first draft from the AI model (or the post's hashtag), edited before it's added. */
  const filterLikeThis = async () => {
    const wait = f7.dialog.preloader('Thinking…');
    const d = await like_.draft(p);
    wait.close();
    f7.dialog.prompt(d.error ?? 'A word, phrase, #hashtag or topic. Change it any time in Keyword filters.', 'Filter posts like this', async v => {
      const err = await like_.add(v, 'hide');
      f7.toast.create({ text: err ?? 'Filter added', closeTimeout: 1500 }).open();
    }, () => {}, d.text);
  };
  // Your own posts: Edit and Delete, as Mastodon offers them.
  const mine = useIsMe(p.acct) && !!p.statusId;
  const [editing, setEditing] = useState(false);
  const del = useDeletePost();
  const confirmDelete = () => f7.dialog.confirm('It’s removed from Fedizen and from the servers it reached. This can’t be undone.', 'Delete this post?', async () => {
    const ok = await del.remove(p.statusId!);
    f7.toast.create({ text: ok ? 'Post deleted' : del.error ?? 'Couldn’t delete it. Try again.', closeTimeout: 1800 }).open();
  });
  const more = () => f7.actions.create({ buttons: [[
    { text: typeof navigator !== 'undefined' && 'share' in navigator ? 'Share' : 'Copy link', onClick: async () => { if ((await sharePost(p)) === 'copied') f7.toast.create({ text: 'Link copied', closeTimeout: 1500 }).open(); } },
    ...(user && !mine ? [{ text: 'Filter posts like this', onClick: () => void filterLikeThis() }] : []),
    ...(mine ? [{ text: 'Edit', onClick: () => setEditing(true) }, { text: 'Delete', color: 'red', onClick: confirmDelete }] : []),
  ], [{ text: 'Cancel', strong: true }]] }).open();
  return <>
    <PostActionBar post={p} save={save} reactions={reactions} onReply={onReply}
      more={<button type="button" className="atlas-act-more" aria-label="More" onClick={more}><Ellipsis aria-hidden="true" /></button>} />
    {editing && <EditSheet statusId={p.statusId!} onClose={() => setEditing(false)} />}
  </>;
}

/** Phone: reply to a post, in its audience. Opens with the author's handle, as every Mastodon client does. */
export function ReplySheet({ post, onClose }: { post: FedizenPost | null; onClose: () => void }) {
  const r = useReply();
  const [text, setText] = useState('');
  const [confirmed, setConfirmed] = useState<string[]>([]);
  const [cw, setCw] = useState('');
  useEffect(() => { if (post) { const m = replyMention(post.handle); setText(m); setConfirmed(m ? [m.trim()] : []); setCw(post.cw ?? ''); r.clearError(); } }, [post]); // eslint-disable-line react-hooks/exhaustive-deps
  const audience = post ? replyVisibility(post) : 'public';
  const send = async () => {
    if (!post) return;
    const done = await r.reply(post, text, cw);
    if (done) { f7.toast.create({ text: 'Reply posted', closeTimeout: 1500 }).open(); onClose(); }
  };
  return <Sheet opened={!!post} onSheetClosed={onClose} swipeToClose backdrop style={{ height: 'auto' }} className="atlas-reply-sheet">
    {post && <>
      <Block>
        <div style={{ fontWeight: 600, fontSize: 17 }}>Reply to {post.author}</div>
        <p className="atlas-reply-quote">{post.cw ? `Content warning: ${post.cw}` : post.paragraphs.join(' ').slice(0, 160)}</p>
        <div className="atlas-reply-audience"><Icon ios={audience === 'public' ? 'f7:globe' : audience === 'direct' ? 'f7:at' : 'f7:lock'} md={audience === 'public' ? 'material:public' : audience === 'direct' ? 'material:alternate_email' : 'material:lock'} />{AUDIENCE_LABEL[audience]}, like the post</div>
      </Block>
      {post.cw && <Block className="atlas-reply-cw"><label>Content warning<input value={cw} onChange={e => setCw(e.target.value)} maxLength={500} /></label></Block>}
      <Block className="atlas-reply-field">
        <MentionField value={text} onChange={setText} confirmed={confirmed} onConfirm={t => setConfirmed(c => [...c, t])} autoFocus
          people={[{ handle: post.handle, name: post.author, avatar: post.avatar }]} placeholder="Write your reply" label="Your reply" onSubmit={() => void send()} />
      </Block>
      {r.error && <Block><p role="alert" style={{ margin: 0 }}>{r.error}</p></Block>}
      <Block style={{ display: 'flex', gap: 8 }}>
        <Button tonal style={{ flex: 1 }} onClick={onClose}>Cancel</Button>
        <Button fill style={{ flex: 1 }} disabled={!text.trim() || text.trim() === replyMention(post.handle).trim() || r.sending} onClick={() => void send()}>{r.sending ? 'Posting…' : 'Reply'}</Button>
      </Block>
    </>}
  </Sheet>;
}

/** Phone: edit one of your posts (text and content warning, from the post's source), as on desktop. */
function EditSheet({ statusId, onClose }: { statusId: string; onClose: () => void }) {
  const e = useEditPost(statusId);
  const [text, setText] = useState(''), [cw, setCw] = useState('');
  useEffect(() => { if (e.text !== undefined) { setText(e.text); setCw(e.cw ?? ''); } }, [e.text, e.cw]);
  const save = async () => { if (await e.save(text, cw)) { f7.toast.create({ text: 'Post edited', closeTimeout: 1500 }).open(); onClose(); } };
  return <Sheet opened onSheetClosed={onClose} swipeToClose backdrop style={{ height: 'auto' }} className="atlas-reply-sheet">
    <Block>
      <div style={{ fontWeight: 600, fontSize: 17 }}>Edit post</div>
      <p className="atlas-reply-quote">People who saw it will see that it was edited. Images and who can see it stay as posted.</p>
    </Block>
    {e.loading ? <Block>Loading your post…</Block> : e.loadError ? <Block><p role="alert" style={{ margin: 0 }}>{e.loadError}</p></Block> : <>
      <Block className="atlas-reply-cw"><label>Content warning (optional)<input value={cw} onChange={ev => setCw(ev.target.value)} maxLength={MAX_CW} /></label></Block>
      <Block className="atlas-reply-field"><textarea className="atlas-edit-text" value={text} onChange={ev => setText(ev.target.value)} maxLength={MAX_TEXT} rows={6} aria-label="Your post" autoFocus /></Block>
    </>}
    {e.error && <Block><p role="alert" style={{ margin: 0 }}>{e.error}</p></Block>}
    <Block style={{ display: 'flex', gap: 8 }}>
      <Button tonal style={{ flex: 1 }} onClick={onClose}>Cancel</Button>
      <Button fill style={{ flex: 1 }} disabled={e.loading || !!e.loadError || (!text.trim() && !cw.trim()) || e.saving} onClick={() => void save()}>{e.saving ? 'Saving…' : 'Save'}</Button>
    </Block>
  </Sheet>;
}
