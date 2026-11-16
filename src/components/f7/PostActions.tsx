import { useEffect, useState } from 'react';
import { Block, Button, Link, Sheet, f7 } from 'framework7-react';
import { MentionField } from '@/components/social/MentionField';
import type { FedizenPost } from '@/lib/fedizen-feed';
import type { useSaveToggle } from '@/components/social/useFedizenLibrary';
import { AUDIENCE_LABEL, compactCount, replyMention, replyVisibility, sharePost, useReactions, useReply } from '@/components/social/usePostActions';
import { Icon } from './F7Extras';
import { useAtlasAuth } from '@/components/social/AuthState';
import { useFilterLikeThis } from '@/components/social/useFilterLikeThis';

type Save = ReturnType<typeof useSaveToggle>;
type Reactions = ReturnType<typeof useReactions>;

/**
 * Phone: the standard post actions — Reply, Boost, Like, Save, Share — as an icon row with counts. Reply, Boost, Like
 * and Save act on Fedizen as the person (signed in, connected); Share works for everyone. A post Fedizen's API can't
 * address (no status id) offers Share only.
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
  return <div className="atlas-post-actions" role="group" aria-label="Post actions">
    {acts && <>
      <Link onClick={() => onReply(p)} aria-label={`Reply${p.counts?.replies ? `, ${p.counts.replies} replies` : ''}`}>
        <Icon ios="f7:bubble_left" md="material:chat_bubble_outline" /><span>{compactCount(p.counts?.replies ?? 0)}</span>
      </Link>
      <Link onClick={() => boostable && void reactions.toggle(p, 'boost')} aria-pressed={boost.on} aria-disabled={boost.pending || !boostable}
        className={`${boost.on ? 'on' : ''}${boost.pending || !boostable ? ' disabled' : ''}`} aria-label={`${boost.on ? 'Undo boost' : 'Boost'}${boost.count ? `, ${boost.count}` : ''}`}>
        <Icon ios="f7:arrow_2_squarepath" md="material:repeat" /><span>{compactCount(boost.count)}</span>
      </Link>
      <Link onClick={() => void reactions.toggle(p, 'like')} aria-pressed={like.on} aria-disabled={like.pending}
        className={`${like.on ? 'on' : ''}${like.pending ? ' disabled' : ''}`} aria-label={`${like.on ? 'Unlike' : 'Like'}${like.count ? `, ${like.count}` : ''}`}>
        <Icon ios={like.on ? 'f7:heart_fill' : 'f7:heart'} md={like.on ? 'material:favorite' : 'material:favorite_border'} /><span>{compactCount(like.count)}</span>
      </Link>
      {save.canSave && <Link onClick={() => void save.toggle(p)} aria-pressed={saved} aria-disabled={save.isPending(p)}
        className={`${saved ? 'on' : ''}${save.isPending(p) ? ' disabled' : ''}`} aria-label={saved ? 'Remove from saved' : 'Save'}>
        <Icon ios={saved ? 'f7:bookmark_fill' : 'f7:bookmark'} md={saved ? 'material:bookmark' : 'material:bookmark_border'} />
      </Link>}
    </>}
    <Link className="atlas-post-share" aria-label="Share" onClick={async () => {
      const r = await sharePost(p);
      if (r === 'copied') f7.toast.create({ text: 'Link copied', closeTimeout: 1500 }).open();
    }}><Icon ios="f7:square_arrow_up" md="material:share" /></Link>
    {user && <Link aria-label="More" onClick={() => f7.actions.create({ buttons: [[{ text: 'Filter posts like this', onClick: () => void filterLikeThis() }], [{ text: 'Cancel', strong: true }]] }).open()}>
      <Icon ios="f7:ellipsis" md="material:more_horiz" />
    </Link>}
  </div>;
}

/** Phone: reply to a post, in its audience. Opens with the author's handle, as every Mastodon client does. */
export function ReplySheet({ post, onClose }: { post: FedizenPost | null; onClose: () => void }) {
  const r = useReply();
  const [text, setText] = useState('');
  const [confirmed, setConfirmed] = useState<string[]>([]);
  useEffect(() => { if (post) { const m = replyMention(post.handle); setText(m); setConfirmed(m ? [m.trim()] : []); r.clearError(); } }, [post]); // eslint-disable-line react-hooks/exhaustive-deps
  const audience = post ? replyVisibility(post) : 'public';
  const send = async () => {
    if (!post) return;
    const done = await r.reply(post, text);
    if (done) { f7.toast.create({ text: 'Reply posted', closeTimeout: 1500 }).open(); onClose(); }
  };
  return <Sheet opened={!!post} onSheetClosed={onClose} swipeToClose backdrop style={{ height: 'auto' }} className="atlas-reply-sheet">
    {post && <>
      <Block>
        <div style={{ fontWeight: 600, fontSize: 17 }}>Reply to {post.author}</div>
        <p className="atlas-reply-quote">{post.paragraphs.join(' ').slice(0, 160)}</p>
        <div className="atlas-reply-audience"><Icon ios={audience === 'public' ? 'f7:globe' : audience === 'direct' ? 'f7:at' : 'f7:lock'} md={audience === 'public' ? 'material:public' : audience === 'direct' ? 'material:alternate_email' : 'material:lock'} />{AUDIENCE_LABEL[audience]}, like the post</div>
      </Block>
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
