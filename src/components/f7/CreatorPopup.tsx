import { Popup, Page, Navbar, NavRight, Link, Icon, Button, Card, CardContent, CardFooter } from 'framework7-react';
import { posts, type Creator } from '@/lib/social-catalogue';
import { avatarPreset } from '@/lib/atlas-avatars';
import { linkifyHashtags, hashtagUrl } from '@/lib/hashtags';
import { useSocial } from '@/components/social/SocialState';

/** Sample creator profile: memoji avatar, bio with linkified hashtags, featured tags, their stories. */
export function CreatorPopup({ creator, onClose }: { creator: Creator | null; onClose: () => void }) {
  const { followed, toggleFollow, saved, toggleSave } = useSocial();
  const theirPosts = creator ? posts.filter(p => p.creatorId === creator.id) : [];

  return (
    <Popup opened={!!creator} onPopupClosed={onClose} className="atlas-creator-popup">
      {creator && (
        <Page>
          <Navbar title={creator.name}>
            <NavRight>
              <Link iconOnly popupClose aria-label="Close creator profile">
                <Icon ios="f7:xmark" md="material:close" />
              </Link>
            </NavRight>
          </Navbar>
          <header className="atlas-profile-header">
            <img className="atlas-profile-avatar" src={avatarPreset(creator.avatar_key).src} alt={`${creator.name} avatar`} width={96} height={96} />
            <h1>{creator.name}</h1>
            <p className="atlas-profile-email">{creator.handle} · {creator.network}</p>
            <div className="atlas-profile-stats">
              <span><strong>{creator.followers}</strong> Followers</span>
              <span><strong>{theirPosts.length}</strong> Stories</span>
            </div>
            <p className="atlas-profile-bio">{linkifyHashtags(creator.bio)}</p>
            {creator.featured_hashtags.length > 0 && (
              <div className="atlas-profile-tags" aria-label="Featured hashtags">
                {creator.featured_hashtags.map(tag => (
                  <a key={tag} className="atlas-profile-tag" href={hashtagUrl(tag)} target="_blank" rel="noopener noreferrer">#{tag}</a>
                ))}
              </div>
            )}
            <div className="atlas-profile-actions">
              <Button small round fill={!followed.includes(creator.id)} tonal={followed.includes(creator.id)}
                onClick={() => toggleFollow(creator.id)}>
                {followed.includes(creator.id) ? 'Following' : 'Follow'}
              </Button>
              <Button small round tonal external href={creator.url} target="_blank">Visit site</Button>
            </div>
          </header>
          <p className="atlas-profile-sample">Sample profile, not a live account.</p>
          {theirPosts.map(p => (
            <Card key={p.id} outline className="atlas-f7-card">
              <img src={p.image} alt={p.alt} loading="lazy" style={{ width: '100%', aspectRatio: '16/10', objectFit: 'cover', display: 'block' }} />
              <CardContent>
                <div style={{ fontSize: 12, opacity: 0.6 }}>{p.kind}</div>
                <div style={{ fontFamily: 'Instrument Serif, serif', fontSize: 22, lineHeight: 1.15, margin: '6px 0' }}>{p.title}</div>
                <div style={{ opacity: 0.75 }}>{p.excerpt}</div>
              </CardContent>
              <CardFooter>
                <Link external target="_blank" href={p.url}>Open</Link>
                <Link onClick={() => toggleSave(p.id)}>{saved.includes(p.id) ? 'Saved' : 'Save'}</Link>
              </CardFooter>
            </Card>
          ))}
        </Page>
      )}
    </Popup>
  );
}
