import { useState } from 'react';
import { Popup, Page, Navbar, NavRight, Link, Button, Segmented, Icon } from 'framework7-react';
import { useAtlasAuth } from '@/components/social/AuthState';
import { useSocial } from '@/components/social/SocialState';
import { avatarPreset } from '@/lib/atlas-avatars';
import { creators, posts } from '@/lib/social-catalogue';

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

export function ProfilePopup({ opened, onClose }: { opened: boolean; onClose: () => void }) {
  const { user, profile, signOut } = useAtlasAuth();
  const { followed, saved, toggleSave } = useSocial();
  const [section, setSection] = useState<Section>('Posts');
  const savedPosts = posts.filter(post => saved.includes(post.id));
  const followedCreators = creators.filter(creator => followed.includes(creator.id));
  const empty = emptySections[section];
  const hasContent = (section === 'Saved' && savedPosts.length > 0) || (section === 'Feeds' && followedCreators.length > 0);

  return (
    <Popup opened={opened} onPopupClosed={onClose} swipeToClose className="atlas-profile-popup">
      <Page>
        <Navbar title="Profile">
          <NavRight><Link popupClose aria-label="Close profile">Done</Link></NavRight>
        </Navbar>
        {user && <>
          <header className="atlas-profile-header">
            <img className="atlas-profile-avatar" src={avatarPreset(profile?.avatar_key).src} alt="Your avatar" width={96} height={96} />
            <h1>{profile?.display_name || 'Your profile'}</h1>
            <p className="atlas-profile-email">{user.email}</p>
            <div className="atlas-profile-stats">
              <span><strong>{followed.length}</strong> Following</span>
              <span><strong>{saved.length}</strong> Saved</span>
            </div>
          </header>
          <div className="atlas-profile-navigation">
            <Segmented strong round className="atlas-profile-segments" role="tablist" aria-label="Profile sections">
              {sections.map(item => <Button key={item} round active={section === item}
                role="tab" aria-selected={section === item} aria-controls="atlas-profile-content"
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
              <Link external target="_blank" rel="noopener noreferrer" href={post.url} className="atlas-profile-story-image"><img src={post.image} alt={post.alt} loading="lazy" /></Link>
              <div className="atlas-profile-story-body">
                <span className="atlas-profile-story-meta">{creators.find(creator => creator.id === post.creatorId)?.name} · {post.kind}</span>
                <h2><Link external target="_blank" rel="noopener noreferrer" href={post.url}>{post.title}</Link></h2>
                <p>{post.excerpt}</p>
                <Button small tonal onClick={() => toggleSave(post.id)}><Icon ios="f7:bookmark_fill" md="material:bookmark" /> Remove from saved</Button>
              </div>
            </article>)}
            {section === 'Feeds' && followedCreators.map(creator => <Link key={creator.id} external target="_blank" rel="noopener noreferrer" href={creator.url} className="atlas-profile-feed">
              <span className="social-avatar">{creator.initials}</span>
              <span><strong>{creator.name}</strong><small>{creator.network} · {creator.handle}</small></span>
              <Icon ios="f7:arrow_up_right" md="material:open_in_new" />
            </Link>)}
          </section>
          <footer className="atlas-profile-footer">
            <Button small onClick={async () => { await signOut(); onClose(); }}>Sign out</Button>
          </footer>
        </>}
      </Page>
    </Popup>
  );
}