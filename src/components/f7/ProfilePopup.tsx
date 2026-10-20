import { useState } from 'react';
import { Popup, Page, Navbar, NavRight, Link, Button, Segmented, Icon, Sheet, Block, List, ListInput, f7 } from 'framework7-react';
import { useAtlasAuth } from '@/components/social/AuthState';
import { useSocial } from '@/components/social/SocialState';
import { avatarPreset } from '@/lib/atlas-avatars';
import { creators, posts } from '@/lib/social-catalogue';
import { linkifyHashtags, extractHashtags, hashtagUrl } from '@/lib/hashtags';

const sections = ['Posts', 'Media', 'Saved', 'Feeds', 'Collections', 'Lists'] as const;
type Section = (typeof sections)[number];
const emptySections: Record<Section, { ios: string; md: string; title: string; detail: string }> = {
  Posts: { ios: 'f7:square_pencil', md: 'material:edit_note', title: 'No posts yet', detail: 'Your posts will appear here once publishing is connected.' },
  Media: { ios: 'f7:photo_on_rectangle', md: 'material:photo_library', title: 'No media yet', detail: 'Photos and videos you share will appear here.' },
  Saved: { ios: 'f7:bookmark', md: 'material:bookmark_border', title: 'Nothing saved yet', detail: 'Stories you save in Discover will appear here.' },
  Feeds: { ios: 'f7:rectangle_stack', md: 'material:dynamic_feed', title: 'No feeds yet', detail: 'Follow a creator to see their feed here.' },
  Collections: { ios: 'f7:folder', md: 'material:folder_open', title: 'No collections yet', detail: 'Your collections will appear here when organizing is available.' },
  Lists: { ios: 'f7:list_bullet', md: 'material:format_list_bulleted', title: 'No lists yet', detail: 'Your creator lists will appear here when lists are available.' },
};

/** Edit sheet for the bio and Mastodon-style featured hashtags. */
function EditProfileSheet({ opened, onClose }: { opened: boolean; onClose: () => void }) {
  const { profile, updateProfile } = useAtlasAuth();
  const [bio, setBio] = useState(profile?.bio ?? '');
  const [tags, setTags] = useState((profile?.featured_hashtags ?? []).map(t => `#${t}`).join(' '));
  const [saving, setSaving] = useState(false);

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
    <Sheet opened={opened} onSheetClosed={onClose} swipeToClose backdrop style={{ height: 'auto' }}>
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

export function ProfilePopup({ opened, onClose }: { opened: boolean; onClose: () => void }) {
  const { user, profile, signOut } = useAtlasAuth();
  const { followed, saved, toggleSave } = useSocial();
  const [section, setSection] = useState<Section>('Posts');
  const [editOpen, setEditOpen] = useState(false);
  const savedPosts = posts.filter(post => saved.includes(post.id));
  const followedCreators = creators.filter(creator => followed.includes(creator.id));
  const empty = emptySections[section];
  const hasContent = (section === 'Saved' && savedPosts.length > 0) || (section === 'Feeds' && followedCreators.length > 0);
  const featured = profile?.featured_hashtags ?? [];

  const openSettings = () => {
    onClose();
    f7.tab.show('#tab-settings');
  };

  return (
    <Popup opened={opened} onPopupClosed={onClose} swipeToClose className="atlas-profile-popup">
      <Page>
        <Navbar title="Profile">
          <NavRight>
            <Link iconOnly aria-label="Profile settings" onClick={openSettings}>
              <Icon ios="f7:gear_alt" md="material:settings" />
            </Link>
            <Link popupClose aria-label="Close profile">Done</Link>
          </NavRight>
        </Navbar>
        {user && <>
          <header className="atlas-profile-header">
            <img className="atlas-profile-avatar" src={avatarPreset(profile?.avatar_key).src} alt="Your avatar" width={96} height={96} />
            <h1>{profile?.display_name || 'Your profile'}</h1>
            <p className="atlas-profile-email">{user.email}</p>
            <div className="atlas-profile-stats">
              <span><strong>0</strong> Followers</span>
              <span><strong>{followed.length}</strong> Following</span>
            </div>
            {profile?.bio ? (
              <p className="atlas-profile-bio">{linkifyHashtags(profile.bio)}</p>
            ) : (
              <p className="atlas-profile-bio atlas-profile-bio-empty">No bio yet — add one so people know what you share.</p>
            )}
            {featured.length > 0 && (
              <div className="atlas-profile-tags" aria-label="Featured hashtags">
                {featured.map(tag => (
                  <a key={tag} className="atlas-profile-tag" href={hashtagUrl(tag)} target="_blank" rel="noopener noreferrer">#{tag}</a>
                ))}
              </div>
            )}
            <Button small tonal className="atlas-profile-edit" onClick={() => setEditOpen(true)}>
              <Icon ios="f7:pencil" md="material:edit" /> Edit profile
            </Button>
          </header>
          <div className="atlas-profile-navigation" role="tablist" aria-label="Profile sections">
            <Segmented strong round className="atlas-profile-segments">
              {sections.map(item => <Button key={item} round active={section === item}
                {...{ role: 'tab' }} aria-selected={section === item} aria-controls="atlas-profile-content"
                id={`atlas-profile-tab-${item.toLowerCase()}`} onClick={() => setSection(item)}>{item}</Button>)}
            </Segmented>
          </div>
          <section id="atlas-profile-content" className="atlas-profile-content" role="tabpanel" aria-labelledby={`atlas-profile-tab-${section.toLowerCase()}`}>
            {!hasContent && <div className="atlas-profile-empty">
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
                <Button small tonal onClick={() => toggleSave(post.id)}><Icon ios="f7:bookmark_fill" md="material:bookmark" /> Remove from saved</Button>
              </div>
            </article>)}
            {section === 'Feeds' && followedCreators.map(creator => <Link key={creator.id} external target="_blank" {...{ rel: 'noopener noreferrer' }} href={creator.url} className="atlas-profile-feed">
              <span className="social-avatar">{creator.initials}</span>
              <span><strong>{creator.name}</strong><small>{creator.network} · {creator.handle}</small></span>
              <Icon ios="f7:arrow_up_right" md="material:open_in_new" />
            </Link>)}
          </section>
          <footer className="atlas-profile-footer">
            <Button small onClick={async () => { await signOut(); onClose(); }}>Sign out</Button>
          </footer>
        </>}
        <EditProfileSheet opened={editOpen} onClose={() => setEditOpen(false)} />
      </Page>
    </Popup>
  );
}
