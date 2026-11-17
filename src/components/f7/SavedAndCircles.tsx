import { useState } from 'react';
import { Block, BlockFooter, BlockTitle, Button, Icon, Link, List, ListInput, ListItem, Navbar, NavRight, Page, Popup, Toggle, f7 } from 'framework7-react';
import { pinCircle, unpinCircle, usePinnedCircles } from '@/lib/feed-types';
import { useAtlasAuth } from '@/components/social/AuthState';
import type { FedizenPost } from '@/lib/fedizen-feed';
import { openTag } from '@/lib/hashtags';
import { BoostedBy, canOpen, linkifyPost, openAuthor } from '@/components/social/PostPeople';
import { ArticleCard } from './ArticleAuthors';
import { VideoPlayer } from '@/components/social/VideoPlayer';
import { MobileFilterGate } from './FilterGate';
import { SensitiveMedia } from '@/components/social/SensitiveMedia';
import { AuthorWarning } from '@/components/social/ContentWarning';
import { useLikedPosts } from '@/components/social/useOwnPosts';
import { LIBRARY_PROBLEM, useCircleActions, useCircleMembers, useFedizenCircles, useFedizenSaved, useSaveToggle } from '@/components/social/useFedizenLibrary';

/**
 * Phone Saved and Circles on the profile, backed by Fedizen (Bonfire): Saved is your bookmarks, and each saved post
 * keeps the audience its author gave it; Circles are your Bonfire circles and the people in them.
 */

const when = (d?: string) => (d ? new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '');

/** Save (bookmark) link for a Fedizen post card. */
export function SaveLink({ post, save }: { post: Pick<FedizenPost, 'statusId' | 'bookmarked'>; save: ReturnType<typeof useSaveToggle> }) {
  if (!post.statusId || !save.canSave) return null;
  const on = save.isSaved(post);
  return <Link onClick={() => void save.toggle(post)} aria-pressed={on} aria-disabled={save.isPending(post)} className={`atlas-save-link${save.isPending(post) ? ' disabled' : ''}`}>
    <Icon ios={on ? 'f7:bookmark_fill' : 'f7:bookmark'} md={on ? 'material:bookmark' : 'material:bookmark_border'} />{on ? 'Saved' : 'Save'}
  </Link>;
}

/** A saved or liked post on the phone, with keyword filters, content warnings and sensitive media as in the feeds. */
function SavedPostCard({ p, save }: { p: FedizenPost; save: ReturnType<typeof useSaveToggle> }) {
  return <MobileFilterGate post={p}><article className="atlas-saved-post">
    <BoostedBy post={p} className="atlas-saved-boost" />
    <div className="atlas-saved-head">{canOpen(p)
      ? <button type="button" className="atlas-author-button" onClick={() => openAuthor(p)} aria-label={`${p.author} ${p.handle}. Open their profile`}>{p.avatar && <img src={p.avatar} alt="" width={32} height={32} />}<span><b>{p.author}</b> <span>{p.handle} · {when(p.date)}</span></span></button>
      : <>{p.avatar && <img src={p.avatar} alt="" width={32} height={32} />}<span><b>{p.author}</b> <span>{p.handle} · {when(p.date)}</span></span></>}</div>
    <AuthorWarning cw={p.cw} phone>{p.paragraphs.map((t, i) => <p key={i}>{linkifyPost(t, p.mentions, openTag)}</p>)}
      <SensitiveMedia sensitive={p.sensitive} cta="Tap to view">{p.video ? <VideoPlayer video={p.video} /> : p.image && <img className="atlas-saved-image" src={p.image} alt="" loading="lazy" />}</SensitiveMedia>
      <ArticleCard article={p.article} /></AuthorWarning>
    <div className="atlas-saved-actions"><SaveLink post={p} save={save} /><Link external target="_blank" href={p.url}>Open</Link></div>
  </article></MobileFilterGate>;
}

/** Profile → Saved on the phone. `stories` are discovery stories saved this session, shown after. */
export function MobileSaved({ stories }: { stories?: React.ReactNode }) {
  const q = useFedizenSaved();
  const save = useSaveToggle();
  const posts = q.data?.posts ?? [];
  const empty = !q.isLoading && !q.data?.error && !posts.length && !stories;
  return <div className="atlas-library">
    <p className="atlas-library-note">Posts you save on Fedizen. Each keeps the audience its author chose.</p>
    {q.isLoading && <p className="atlas-library-note">Loading your saved posts…</p>}
    {(q.data?.error || q.isError) && <p role="alert" className="atlas-library-note">{LIBRARY_PROBLEM[q.data?.error ?? 'unavailable']}</p>}
    {save.error && <p role="alert" className="atlas-library-error">{save.error}</p>}
    {posts.map(p => <SavedPostCard key={p.id} p={p} save={save} />)}
    {empty && <div className="atlas-profile-empty">
      <div className="atlas-profile-empty-icon"><Icon ios="f7:bookmark" md="material:bookmark_border" /></div>
      <h2>Nothing saved yet</h2>
      <p>Save posts from your Fedizen feed, and they’ll be here.</p>
    </div>}
    {stories}
  </div>;
}

/** Profile → Liked on the phone: posts you liked on Fedizen. Only you see this tab. */
export function MobileLiked() {
  const q = useLikedPosts();
  const save = useSaveToggle();
  return <div className="atlas-library">
    <p className="atlas-library-note">Only you can see what you’ve liked.</p>
    {q.loading && <p className="atlas-library-note">Loading posts you liked…</p>}
    {q.error && <p role="alert" className="atlas-library-note">{q.error}</p>}
    {q.posts.map(p => <SavedPostCard key={p.id} p={p} save={save} />)}
    {!q.loading && !q.error && !q.posts.length && <div className="atlas-profile-empty">
      <div className="atlas-profile-empty-icon"><Icon ios="f7:heart" md="material:favorite_border" /></div>
      <h2>No likes yet</h2>
      <p>Posts you like will be here.</p>
    </div>}
  </div>;
}

/** Profile → Circles on the phone: your Bonfire circles; tap one to see and change who's in it. */
export function MobileCircles() {
  const q = useFedizenCircles();
  const act = useCircleActions();
  const [open, setOpen] = useState<{ id: string; title: string } | null>(null);
  const circles = q.data?.circles ?? [];
  const canWrite = !!q.data?.canWrite;
  const create = () => f7.dialog.prompt('Name your circle, like Close friends or Neighbours.', 'New circle', async value => {
    const t = value.trim();
    if (!t) return;
    const err = await act.create(t.slice(0, 100));
    if (err) f7.toast.show({ text: err, closeTimeout: 3000 });
  });
  return <div className="atlas-library">
    <p className="atlas-library-note">Circles group the people you know, so you choose who sees and replies to each post. They’re your circles on Fedizen.</p>
    {q.isLoading && <p className="atlas-library-note">Loading your circles…</p>}
    {q.data?.error && <p role="alert" className="atlas-library-note">{LIBRARY_PROBLEM[q.data.error]}</p>}
    {circles.length > 0 && <List strong inset dividers>
      {circles.map(c => <ListItem key={c.id} link="#" title={c.title} onClick={() => setOpen(c)}><Icon slot="media" ios="f7:circle_grid_hex" md="material:bubble_chart" /></ListItem>)}
    </List>}
    {!q.isLoading && !q.data?.error && !circles.length && <div className="atlas-profile-empty">
      <div className="atlas-profile-empty-icon"><Icon ios="f7:circle_grid_hex" md="material:bubble_chart" /></div>
      <h2>No circles yet</h2>
      <p>Make one for the people you share with most.</p>
    </div>}
    {!q.isLoading && !q.data?.error && (canWrite
      ? <Block><Button tonal round onClick={create} disabled={act.busy}><Icon ios="f7:plus" md="material:add" /> New circle</Button></Block>
      : <p className="atlas-library-note">{LIBRARY_PROBLEM['needs-permission']}</p>)}
    <CirclePopup circle={open} canWrite={canWrite} onClose={() => setOpen(null)} />
  </div>;
}

function CirclePopup({ circle, canWrite, onClose }: { circle: { id: string; title: string } | null; canWrite: boolean; onClose: () => void }) {
  const q = useCircleMembers(circle?.id ?? null);
  const act = useCircleActions();
  const [handle, setHandle] = useState(''), [note, setNote] = useState<string | null>(null);
  const people = q.data?.people ?? [];
  const { user } = useAtlasAuth();
  const pinned = usePinnedCircles(user?.id).some(c => c.id === circle?.id);
  const add = async () => { if (!circle || !handle.trim()) return; const err = await act.addMember(circle.id, handle.trim()); setNote(err); if (!err) setHandle(''); };
  const remove = () => circle && f7.dialog.confirm(`Delete “${circle.title}”? People in it aren’t told, and posts shared with it keep their audience.`, 'Delete circle', async () => {
    const err = await act.remove(circle.id);
    if (err) setNote(err); else { if (user) unpinCircle(user.id, circle.id); onClose(); }
  });
  return <Popup opened={!!circle} onPopupClosed={() => { setNote(null); setHandle(''); onClose(); }} swipeToClose>
    <Page>
      <Navbar title={circle?.title ?? 'Circle'}><NavRight><Link iconOnly popupClose aria-label="Close"><Icon ios="f7:xmark" md="material:close" /></Link></NavRight></Navbar>
      {q.isLoading && <Block>Loading who’s in it…</Block>}
      {q.data?.error && <Block>{LIBRARY_PROBLEM[q.data.error]}</Block>}
      <BlockTitle>People</BlockTitle>
      <List strong inset dividers mediaList>
        {people.map(p => <ListItem key={p.id} title={p.name} subtitle={p.handle}>
          {p.avatar ? <img slot="media" src={p.avatar} alt="" width={40} height={40} className="atlas-avatar" style={{ objectFit: 'cover' }} referrerPolicy="no-referrer" />
            : <span slot="media" className="atlas-activity-initial" aria-hidden="true">{p.name.charAt(0)}</span>}
          {canWrite && <Link slot="after" iconOnly aria-label={`Remove ${p.name}`} onClick={async () => setNote(await act.removeMember(circle!.id, p.id))}><Icon ios="f7:minus_circle" md="material:remove_circle_outline" /></Link>}
        </ListItem>)}
        {!q.isLoading && !people.length && !q.data?.error && <ListItem title="No one in this circle yet." />}
      </List>
      {canWrite && <>
        <List strong inset>
          <ListInput label="Add someone" type="text" placeholder="@name@server.social" value={handle} onInput={e => setHandle((e.target as HTMLInputElement).value)} clearButton />
        </List>
        <Block><Button fill round onClick={add} disabled={!handle.trim() || act.busy}>Add</Button></Block>
      </>}
      {note && <BlockFooter><span role="alert">{note}</span></BlockFooter>}
      {circle && user && <List strong inset>
        <ListItem title="Pin to Feeds" footer="Read posts from the people in this circle on the Feeds page.">
          <Toggle slot="after" checked={pinned} onToggleChange={() => (pinned ? unpinCircle(user.id, circle.id) : pinCircle(user.id, circle))} />
        </ListItem>
      </List>}
      {canWrite && <Block><Button color="red" round onClick={remove}>Delete circle</Button></Block>}
    </Page>
  </Popup>;
}
