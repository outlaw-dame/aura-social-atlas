import { Popup, Page, Navbar, NavRight, Link, Icon, Button, Card, CardContent, CardFooter } from 'framework7-react';
import { promptSignInToSave } from './save-prompt';
import { posts, fullHandle, podcastFeatureLabels, type Creator } from '@/lib/social-catalogue';
import { avatarPreset } from '@/lib/atlas-avatars';
import { linkifyHashtags, linkifyHashtagsWith, hashtagUrl } from '@/lib/hashtags';
import { useSocial } from '@/components/social/SocialState';
import { NetworkBadge, networkBrands } from '@/lib/networks';
import { CreatorTag } from '@/components/social/CreatorTag';

/** Mastodon-style creator profile: full fediverse handle, verified fields, featured tags, pinned story. */
export function CreatorPopup({ creator, onClose, onOpenTag }: { creator: Creator | null; onClose: () => void; onOpenTag?: (creator: Creator, tag: string) => void }) {
  const { followed, toggleFollow, saved, canSave, toggleSave } = useSocial();
  const theirPosts = creator ? posts.filter(p => p.creatorId === creator.id) : [];
  const pinned = theirPosts.filter(p => p.pinned);
  const rest = theirPosts.filter(p => !p.pinned);

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
            <h1>
              {creator.name}
              {creator.bot && <span className="atlas-profile-flag" title="Automated account"><Icon ios="f7:gear_alt_fill" md="material:smart_toy" /> Bot</span>}
            </h1>
            <p className="atlas-profile-email">{fullHandle(creator)}</p>
            <div className="atlas-profile-meta">
              <span><Icon ios="f7:calendar" md="material:calendar_month" /> Joined {creator.joined}</span>
              <NetworkBadge network={creator.network} />
              {creator.follows_you && <span className="atlas-follows-you">Follows you</span>}
            </div>
            <div className="atlas-profile-stats">
              <span><strong>{creator.followers}</strong> Followers</span>
              <span><strong>{theirPosts.length}</strong> Stories</span>
            </div>
            <p className="atlas-profile-bio">{onOpenTag ? linkifyHashtagsWith(creator.bio, tag => onOpenTag(creator, tag)) : linkifyHashtags(creator.bio)}</p>
            {creator.fields.length > 0 && (
              <dl className="atlas-profile-fields">
                {creator.fields.map(field => (
                  <div key={field.name} className="atlas-profile-field">
                    <dt className="atlas-profile-field-name">{field.name}</dt>
                    <dd className={`atlas-profile-field-value${field.verified ? ' atlas-profile-verified' : ''}`}>
                      {field.verified && <Icon ios="f7:checkmark_seal_fill" md="material:verified" />}
                      {field.url
                        ? <a href={field.url} target="_blank" rel="me noopener noreferrer">{field.value}</a>
                        : field.value}
                    </dd>
                  </div>
                ))}
              </dl>
            )}
            {creator.featured_hashtags.length > 0 && (
              <div className="atlas-profile-tags" aria-label="Featured hashtags">
                {creator.featured_hashtags.map(tag => (
                  <Link key={tag.name} className="atlas-profile-tag" href={onOpenTag ? undefined : hashtagUrl(tag.name)} external={!onOpenTag} onClick={() => onOpenTag?.(creator, tag.name)}>
                    #{tag.name} <small>{tag.count} posts</small>
                  </Link>
                ))}
              </div>
            )}
            {creator.podcast && (
              <div className="atlas-podcast">
                <p className="atlas-podcast-title"><NetworkBadge network="Podcasts" /> feed</p>
                <div className="atlas-profile-tags" aria-label="Podcasting 2.0 features">
                  {creator.podcast.features.map(feature => (
                    <span key={feature} className="atlas-feature-chip" style={{ color: networkBrands.Podcasts.color, background: `color-mix(in oklab, ${networkBrands.Podcasts.color} 10%, transparent)` }}>
                      {podcastFeatureLabels[feature]}
                    </span>
                  ))}
                </div>
                <p className="atlas-podcast-feed">{creator.podcast.feed_url}</p>
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
          {pinned.length > 0 && (
            <p className="atlas-pinned"><Icon ios="f7:pin_fill" md="material:push_pin" /> Pinned story</p>
          )}
          {[...pinned, ...rest].map(p => (
            <Card key={p.id} outline className="atlas-f7-card">
              <img src={p.image} alt={p.alt} loading="lazy" style={{ width: '100%', aspectRatio: '16/10', objectFit: 'cover', display: 'block' }} />
              <CardContent>
                <div style={{ fontSize: 12, opacity: 0.6, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                  <NetworkBadge network={creator.network} /> · {p.kind} · <span style={{ opacity: 0.8 }}>{fullHandle(creator)}</span>
                </div>
                <div style={{ fontFamily: 'Instrument Serif, serif', fontSize: 22, lineHeight: 1.15, margin: '6px 0' }}>{p.title}</div>
                <div style={{ opacity: 0.75 }}>{p.excerpt}</div>
                <div className="atlas-story-tags">{p.tags.map(tag => <Link key={tag} className="atlas-hashtag" onClick={() => onOpenTag?.(creator, tag)}>#{tag}</Link>)}</div>
                <CreatorTag creator={creator} onOpen={() => document.querySelector('.atlas-creator-popup .page-content')?.scrollTo({ top: 0, behavior: 'smooth' })} />
              </CardContent>
              <CardFooter>
                <Link external target="_blank" href={p.url}>Open</Link>
                <Link onClick={() => (canSave ? toggleSave(p.id) : promptSignInToSave())}>{saved.includes(p.id) ? 'Saved' : 'Save'}</Link>
              </CardFooter>
            </Card>
          ))}
        </Page>
      )}
    </Popup>
  );
}
