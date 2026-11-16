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
  const more = () => f7.actions.create({ buttons: [[
    { text: typeof navigator !== 'undefined' && 'share' in navigator ? 'Share' : 'Copy link', onClick: async () => { if ((await sharePost(p)) === 'copied') f7.toast.create({ text: 'Link copied', closeTimeout: 1500 }).open(); } },
    ...(user ? [{ text: 'Filter posts like this', onClick: () => void filterLikeThis() }] : []),
  ], [{ text: 'Cancel', strong: true }]] }).open();
  return <PostActionBar post={p} save={save} reactions={reactions} onReply={onReply}
    more={<button type="button" className="atlas-act-more" aria-label="More" onClick={more}><Ellipsis aria-hidden="true" /></button>} />;
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
