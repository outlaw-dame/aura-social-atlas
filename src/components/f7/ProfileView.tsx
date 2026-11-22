import { useEffect, useState } from 'react';
import { Link, Button, Icon, Sheet, Block, List, ListInput, ListItem, Popup, Page, Navbar, NavRight, f7 } from 'framework7-react';
import { useAtlasAuth } from '@/components/social/AuthState';
import { useSocial } from '@/components/social/SocialState';
import { avatarPreset } from '@/lib/atlas-avatars';
import { IdentityAvatar } from '@/components/social/IdentityAvatar';
import { useFedizenIdentity } from '@/components/social/useFedizenIdentity';
import { creators, posts, fullHandle, type Creator } from '@/lib/social-catalogue';
import { CreatorTag } from '@/components/social/CreatorTag';
import { linkifyHashtags, extractHashtags, hashtagLabel, hashtagUrl, TagText } from '@/lib/hashtags';
import type { Collection } from '@/lib/collections';
import { MyCollections } from './Collections';
import { MobileCircles, MobileLiked, MobileSaved } from './SavedAndCircles';
import { activityLabel, DEFAULT_ACTIVITY_FILTER, type ActivityFilter } from '@/components/social/profile-sections';

/* Profile tabs after Mastodon's 2026 redesign: Activity (posts, quote posts, replies and boosts, filtered like
   Mastodon's Activity menu), Featured (Mastodon 4.4: featured hashtags and profiles), Media, Collections (Mastodon
   4.6), Saved (your Fedizen bookmarks), Liked (only you see it), then Circles (Bonfire's circles of people); no Lists tab, since on Fedizen lists are circles. Follows are not a tab:
   they open from the Following count. */
const sections = ['Activity', 'Featured', 'Media', 'Collections', 'Saved', 'Liked', 'Circles'] as const;
type Section = (typeof sections)[number];
const emptySections: Record<Section, { ios: string; md: string; title: string; detail: string }> = {
  Activity: { ios: 'f7:square_pencil', md: 'material:edit_note', title: 'No activity yet', detail: 'Your public posts, quote posts, replies and boosts on Fedizen will appear here.' },
  Featured: { ios: 'f7:star', md: 'material:star_outline', title: 'Nothing featured yet', detail: 'Feature hashtags from Edit profile, and people from their profiles, to show them here.' },
  Media: { ios: 'f7:photo_on_rectangle', md: 'material:photo_library', title: 'No media yet', detail: 'Photos and videos you share will appear here.' },
  Collections: { ios: 'f7:square_stack_3d_up', md: 'material:collections_bookmark', title: 'No collections yet', detail: '' },
  Saved: { ios: 'f7:bookmark', md: 'material:bookmark_border', title: 'Nothing saved yet', detail: 'Posts you save on Fedizen. Each keeps the audience its author chose.' },
  Liked: { ios: 'f7:heart', md: 'material:favorite_border', title: 'No likes yet', detail: 'Posts you like will be here.' },
  Circles: { ios: 'f7:circle_grid_hex', md: 'material:bubble_chart', title: 'No circles yet', detail: 'Circles group the people you know, like colleagues, friends or locals, so you choose who sees and replies to each post. Circles you make on Fedizen will appear here.' },
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
  const identity = useFedizenIdentity();
  const { followed, saved, toggleSave, toggleFollow } = useSocial();
  const [section, setSection] = useState<Section>('Activity');
  const [filter, setFilter] = useState<ActivityFilter>(DEFAULT_ACTIVITY_FILTER);
  const [followsOpen, setFollowsOpen] = useState(false);
  const savedPosts = posts.filter(post => saved.includes(post.id));
  const followedCreators = creators.filter(creator => followed.includes(creator.id));
  const empty = emptySections[section];
  const hasContent = (section === 'Saved' && savedPosts.length > 0) || (section === 'Featured' && (profile?.featured_hashtags ?? []).length > 0);
  const featured = profile?.featured_hashtags ?? [];

  if (!user) return (
    <div className="atlas-profile-empty">
      <div className="atlas-profile-empty-icon"><Icon ios="f7:person_crop_circle" md="material:account_circle" /></div>
      <h2>Your profile</h2>
      <p>Sign in to set up your profile and save stories to come back to.</p>
      <Button fill round external href="/auth" style={{ marginTop: 12 }}>Sign in</Button>
    </div>
  );

  const name = identity.name;
  return (
    <div className="atlas-bsky">
      <div className="atlas-bsky-banner" aria-hidden="true" />
      <header className="atlas-bsky-head">
        <div className="atlas-bsky-row">
          <IdentityAvatar className="atlas-bsky-avatar" src={identity.avatar} name={identity.name} alt="Your profile avatar" />
          <Button small round tonal className="atlas-bsky-edit" onClick={onEditProfile}>Edit profile</Button>
        </div>
        <h1 className="atlas-bsky-name">{name}</h1>
        <p className="atlas-bsky-handle">{identity.handle}</p>
        {identity.viewer?.profileUrl && <a href={identity.viewer.profileUrl} target="_blank" rel="noopener noreferrer" className="atlas-bsky-handle">View your verified Fedizen profile</a>}
        {identity.isFedizen && !identity.viewer && <p className="atlas-bsky-handle">Fedizen profile not verified. No substitute photo is shown.</p>}
        <p className="atlas-bsky-counts">
          <span><strong>{identity.counts?.followers ?? '—'}</strong> followers</span>
          {identity.isFedizen
            ? <span><strong>{identity.counts?.following ?? '—'}</strong> following</span>
            : <Link className="atlas-bsky-count-link" onClick={() => setFollowsOpen(true)}><strong>{followed.length}</strong> following in Atlas</Link>}
          <span><strong>{identity.counts?.posts ?? '—'}</strong> posts</span>
        </p>
        {profile?.bio
          ? <p className="atlas-bsky-bio"><span className="atlas-bsky-handle">Atlas notes · </span>{linkifyHashtags(profile.bio)}</p>
          : <p className="atlas-bsky-bio atlas-profile-bio-empty">Profile details are managed on Fedizen. Atlas-specific notes can be added here.</p>}
        {profile?.created_at && (
          <p className="atlas-bsky-joined"><Icon ios="f7:calendar" md="material:calendar_month" /> Atlas account created {new Date(profile.created_at).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</p>
        )}
      </header>

      <div className="atlas-bsky-tabs" role="tablist" aria-label="Profile sections">
        {sections.map(item => (
          <button key={item} type="button" role="tab" id={`atlas-profile-tab-${item.toLowerCase()}`} aria-selected={section === item}
            aria-controls="atlas-profile-content" className={section === item ? 'is-active' : undefined} onClick={() => setSection(item)}>
            {item}
          </button>
        ))}
      </div>
      <section id="atlas-profile-content" className="atlas-profile-content" role="tabpanel" aria-labelledby={`atlas-profile-tab-${section.toLowerCase()}`}>
        {section === 'Collections' && <MyCollections onOpen={onOpenCollection} />}
        {section === 'Activity' && <div className="atlas-activity-filter" role="group" aria-label="Show in Activity">
          <span>Showing {activityLabel(filter)}</span>
          {(['replies', 'boosts'] as const).map(k => <button key={k} type="button" aria-pressed={filter[k]} className={filter[k] ? 'is-on' : undefined} onClick={() => setFilter(f => ({ ...f, [k]: !f[k] }))}>
            {filter[k] && <Icon ios="f7:checkmark" md="material:check" />}{k === 'replies' ? 'Replies' : 'Boosts'}</button>)}
        </div>}
        {section === 'Featured' && featured.length > 0 && <div className="atlas-featured">
          <h3>Hashtags</h3>
          <div className="atlas-profile-tags" aria-label="Featured hashtags">{featured.map(tag => <a key={tag} className="atlas-profile-tag" href={hashtagUrl(tag)} aria-label={hashtagLabel(tag)}><TagText tag={tag} /></a>)}</div>
          <h3>Profiles</h3>
          <p>People you feature from their profiles on Fedizen will appear here.</p>
        </div>}
        {section === 'Circles' && <MobileCircles />}
        {section === 'Liked' && <MobileLiked />}
        {!hasContent && !['Collections', 'Saved', 'Liked', 'Circles'].includes(section) && <div className="atlas-profile-empty">
          <div className="atlas-profile-empty-icon"><Icon ios={empty.ios} md={empty.md} /></div>
          <h2>{empty.title}</h2>
          <p>{empty.detail}</p>
        </div>}
        {section === 'Saved' && <MobileSaved stories={savedPosts.length ? <><h3 className="atlas-library-heading">Stories saved in Atlas</h3>{savedPosts.map(post => <article key={post.id} className="atlas-profile-story">
          <Link external target="_blank" {...{ rel: 'noopener noreferrer' }} href={post.url} className="atlas-profile-story-image"><img src={post.image} alt={post.alt} loading="lazy" /></Link>
          <div className="atlas-profile-story-body">
            <span className="atlas-profile-story-meta">{creators.find(creator => creator.id === post.creatorId)?.name} · {post.kind}</span>
            <h2><Link external target="_blank" {...{ rel: 'noopener noreferrer' }} href={post.url}>{post.title}</Link></h2>
            <p>{post.excerpt}</p>
            {(() => { const creator = creators.find(c => c.id === post.creatorId); return creator ? <CreatorTag creator={creator} onOpen={() => onOpenCreator(creator)} /> : null; })()}
            <Button small tonal onClick={() => toggleSave(post.id)}><Icon ios="f7:bookmark_fill" md="material:bookmark" /> Remove from saved</Button>
          </div>
        </article>)}</> : undefined} />}
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
                  <img slot="media" src={avatarPreset(c.avatar_key).src} alt="" width={40} height={40} className="atlas-avatar" style={{ objectFit: 'cover' }} />
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
