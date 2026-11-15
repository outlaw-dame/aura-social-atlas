import { useEffect, useState } from 'react';
import { Link, Button, Icon, Sheet, Block, List, ListInput, ListItem, Popup, Page, Navbar, NavRight, f7 } from 'framework7-react';
import { useAtlasAuth } from '@/components/social/AuthState';
import { useSocial } from '@/components/social/SocialState';
import { avatarPreset } from '@/lib/atlas-avatars';
import { creators, posts, fullHandle, type Creator } from '@/lib/social-catalogue';
import { CreatorTag } from '@/components/social/CreatorTag';
import { linkifyHashtags, extractHashtags, hashtagUrl } from '@/lib/hashtags';
import type { Collection } from '@/lib/collections';
import { MyCollections } from './Collections';

/* Profile tabs follow Bluesky's profile: Posts, Replies, Media, Collections (Mastodon 4.6's curated account
   collections), then the owner-only private tab (Bluesky's Likes/Saved; Atlas's Saved), then Feeds and Lists. Follows are not a tab: they open from the Following count. */
const sections = ['Posts', 'Replies', 'Media', 'Collections', 'Saved', 'Feeds', 'Lists'] as const;
type Section = (typeof sections)[number];
const emptySections: Record<Section, { ios: string; md: string; title: string; detail: string }> = {
  Posts: { ios: 'f7:square_pencil', md: 'material:edit_note', title: 'No posts yet', detail: 'Your posts will appear here once publishing is connected.' },
  Replies: { ios: 'f7:bubble_left_bubble_right', md: 'material:forum', title: 'No replies yet', detail: 'Your replies will appear here once publishing is connected.' },
  Media: { ios: 'f7:photo_on_rectangle', md: 'material:photo_library', title: 'No media yet', detail: 'Photos and videos you share will appear here.' },
  Collections: { ios: 'f7:square_stack_3d_up', md: 'material:collections_bookmark', title: 'No collections yet', detail: '' },
  Saved: { ios: 'f7:bookmark', md: 'material:bookmark_border', title: 'Nothing saved yet', detail: 'Stories you save appear here. Only you can see this tab.' },
  Feeds: { ios: 'f7:rectangle_stack', md: 'material:dynamic_feed', title: 'No feeds yet', detail: 'Custom feeds you create will appear here.' },
  Lists: { ios: 'f7:list_bullet', md: 'material:format_list_bulleted', title: 'No lists yet', detail: 'Your creator lists will appear here when lists are available.' },
};

/** Edit sheet for the bio and Mastodon-style featured hashtags. Rendered at app level:
    Framework7 sheets nested inside a popup break the popup's swipe handler. */
export function EditProfileSheet({ opened, onClose }: { opened: boolean; onClose: () => void }) {
  const { profile, updateProfile } = useAtlasAuth();
  const [bio, setBio] = useState(profile?.bio ?? '');
  const [tags, setTags] = useState((profile?.featured_hashtags ?? []).map(t => `#${t}`).join(' '));
  const [saving, setSaving] = useState(false);

  // The sheet stays mounted at app level, so refresh the fields each time it opens.
  useEffect(() => {
    if (opened) {
      setBio(profile?.bio ?? '');
      setTags((profile?.featured_hashtags ?? []).map(t => `#${t}`).join(' '));
    }
  }, [opened]);

  const save = async () => {
    setSaving(true);
    try {
      await updateProfile({ bio: bio.trim() || null, featured_hashtags: extractHashtags(tags) });
      onClose();
    } catch {
      f7.toast.show({ text: 'Could not save — try again', closeTimeout: 1600 });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet opened={opened} onSheetClosed={onClose} backdrop style={{ height: 'auto' }}>
      <Block>
        <div style={{ fontWeight: 600, fontSize: 17, marginBottom: 4 }}>Edit profile</div>
        <div style={{ fontSize: 13, opacity: 0.6 }}>Hashtags in your bio become links. Featured hashtags show on your profile like they do on Mastodon.</div>
      </Block>
      <List strong inset>
        <ListInput type="textarea" label="Bio" floatingLabel placeholder="Tell people what you share…" value={bio} maxlength={300}
          onInput={(e: any) => setBio(e.target.value)} resizable />
        <ListInput type="text" label="Featured hashtags" floatingLabel placeholder="#design #openweb" value={tags}
          onInput={(e: any) => setTags(e.target.value)} info="Separate with spaces, like on Mastodon." />
      </List>
      <Block style={{ display: 'flex', gap: 8 }}>
        <Button tonal style={{ flex: 1 }} onClick={onClose}>Cancel</Button>
        <Button fill style={{ flex: 1 }} disabled={saving} onClick={save}>{saving ? 'Saving…' : 'Save'}</Button>
      </Block>
    </Sheet>
  );
}

/** The signed-in person's profile — the dock's avatar tab, laid out like a Bluesky profile: banner, avatar,
 *  Edit profile, name, handle, counts (Following opens the list of follows), bio, then the tab strip. */
export function ProfileView({ onEditProfile, onOpenCreator, onOpenCollection }: { onEditProfile: () => void; onOpenCreator: (creator: Creator) => void; onOpenCollection: (c: Collection) => void }) {
  const { user, profile, signOut } = useAtlasAuth();
  const { followed, saved, toggleSave, toggleFollow } = useSocial();
  const [section, setSection] = useState<Section>('Posts');
  const [followsOpen, setFollowsOpen] = useState(false);
  const savedPosts = posts.filter(post => saved.includes(post.id));
  const followedCreators = creators.filter(creator => followed.includes(creator.id));
  const empty = emptySections[section];
  const hasContent = section === 'Saved' && savedPosts.length > 0;
  const featured = profile?.featured_hashtags ?? [];

  if (!user) return (
    <div className="atlas-profile-empty">
      <div className="atlas-profile-empty-icon"><Icon ios="f7:person_crop_circle" md="material:account_circle" /></div>
      <h2>Your profile</h2>
      <p>Sign in to set up your profile and save stories to come back to.</p>
      <Button fill round external href="/auth" style={{ marginTop: 12 }}>Sign in</Button>
    </div>
  );

  const name = profile?.display_name || 'Your profile';
  return (
    <div className="atlas-bsky">
      <div className="atlas-bsky-banner" aria-hidden="true" />
      <header className="atlas-bsky-head">
        <div className="atlas-bsky-row">
          <img className="atlas-bsky-avatar" src={avatarPreset(profile?.avatar_key).src} alt="Your avatar" width={88} height={88} />
          <Button small round tonal className="atlas-bsky-edit" onClick={onEditProfile}>Edit profile</Button>
        </div>
        <h1 className="atlas-bsky-name">{name}</h1>
        <p className="atlas-bsky-handle">{user.email}</p>
        <p className="atlas-bsky-counts">
          <span><strong>0</strong> followers</span>
          <Link className="atlas-bsky-count-link" onClick={() => setFollowsOpen(true)}><strong>{followed.length}</strong> following</Link>
          <span><strong>0</strong> posts</span>
        </p>
        {profile?.bio
          ? <p className="atlas-bsky-bio">{linkifyHashtags(profile.bio)}</p>
          : <p className="atlas-bsky-bio atlas-profile-bio-empty">No bio yet — add one so people know what you share.</p>}
        {featured.length > 0 && (
          <div className="atlas-profile-tags" aria-label="Featured hashtags">
            {featured.map(tag => <a key={tag} className="atlas-profile-tag" href={hashtagUrl(tag)}>#{tag}</a>)}
          </div>
        )}
        {profile?.created_at && (
          <p className="atlas-bsky-joined"><Icon ios="f7:calendar" md="material:calendar_month" /> Joined {new Date(profile.created_at).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</p>
        )}
      </header>

      <div className="atlas-bsky-tabs" role="tablist" aria-label="Profile sections">
        {sections.map(item => (
          <button key={item} type="button" role="tab" id={`atlas-profile-tab-${item.toLowerCase()}`} aria-selected={section === item}
            aria-controls="atlas-profile-content" className={section === item ? 'is-active' : undefined} onClick={() => setSection(item)}>
            {item === 'Saved' && <Icon ios="f7:lock_fill" md="material:lock" />}{item}
          </button>
        ))}
      </div>
      <section id="atlas-profile-content" className="atlas-profile-content" role="tabpanel" aria-labelledby={`atlas-profile-tab-${section.toLowerCase()}`}>
        {section === 'Collections' && <MyCollections onOpen={onOpenCollection} />}
        {!hasContent && section !== 'Collections' && <div className="atlas-profile-empty">
          <div className="atlas-profile-empty-icon"><Icon ios={empty.ios} md={empty.md} /></div>
          <h2>{empty.title}</h2>
          <p>{empty.detail}</p>
        </div>}
        {section === 'Saved' && savedPosts.map(post => <article key={post.id} className="atlas-profile-story">
          <Link external target="_blank" {...{ rel: 'noopener noreferrer' }} href={post.url} className="atlas-profile-story-image"><img src={post.image} alt={post.alt} loading="lazy" /></Link>
          <div className="atlas-profile-story-body">
            <span className="atlas-profile-story-meta">{creators.find(creator => creator.id === post.creatorId)?.name} · {post.kind}</span>
            <h2><Link external target="_blank" {...{ rel: 'noopener noreferrer' }} href={post.url}>{post.title}</Link></h2>
            <p>{post.excerpt}</p>
            {(() => { const creator = creators.find(c => c.id === post.creatorId); return creator ? <CreatorTag creator={creator} onOpen={() => onOpenCreator(creator)} /> : null; })()}
            <Button small tonal onClick={() => toggleSave(post.id)}><Icon ios="f7:bookmark_fill" md="material:bookmark" /> Remove from saved</Button>
          </div>
        </article>)}
      </section>
      <footer className="atlas-profile-footer">
        <Button small onClick={() => { void signOut(); }}>Sign out</Button>
      </footer>

      {/* Following: opened from the count, as on Bluesky — not a tab of its own. */}
      <Popup opened={followsOpen} onPopupClosed={() => setFollowsOpen(false)} swipeToClose>
        <Page>
          <Navbar title="Following" subtitle={name}>
            <NavRight><Link iconOnly popupClose aria-label="Close"><Icon ios="f7:xmark" md="material:close" /></Link></NavRight>
          </Navbar>
          {followedCreators.length ? (
            <List strong inset dividers mediaList>
              {followedCreators.map(c => (
                <ListItem key={c.id} title={c.name} subtitle={fullHandle(c)} link="#" onClick={() => { setFollowsOpen(false); onOpenCreator(c); }}>
                  <img slot="media" src={avatarPreset(c.avatar_key).src} alt="" width={40} height={40} style={{ borderRadius: 20 }} />
                  <Button slot="after" small round tonal onClick={(e: { stopPropagation: () => void }) => { e.stopPropagation(); toggleFollow(c.id); }}>Following</Button>
                </ListItem>
              ))}
            </List>
          ) : (
            <div className="atlas-profile-empty">
              <div className="atlas-profile-empty-icon"><Icon ios="f7:person_2" md="material:group" /></div>
              <h2>Not following anyone yet</h2>
              <p>People you follow in Discover will appear here.</p>
            </div>
          )}
        </Page>
      </Popup>
    </div>
  );
}
