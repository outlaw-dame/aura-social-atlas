import { useEffect, useState } from 'react';
import { Button, Icon, Sheet, Block, List, ListInput, f7 } from 'framework7-react';
import { useAtlasAuth } from '@/components/social/AuthState';
import { IdentityAvatar } from '@/components/social/IdentityAvatar';
import { useFedizenIdentity } from '@/components/social/useFedizenIdentity';
import { useMyFedizenProfile } from '@/components/social/useMyFedizenProfile';
import { ProfileImagePicker } from '@/components/social/ProfileImagePicker';
import { BIO_MAX, isWebsite, LOCATION_MAX, NAME_MAX, WEBSITE_MAX } from '@/lib/fedizen-profile';
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

/** Edit sheet: with Fedizen connected, your Fedizen name, bio, website and location (Bonfire's updateUser), plus
    Atlas's featured hashtags; otherwise Atlas's own bio and featured hashtags. Rendered at app level:
    Framework7 sheets nested inside a popup break the popup's swipe handler. */
export function EditProfileSheet({ opened, onClose }: { opened: boolean; onClose: () => void }) {
  const { profile, updateProfile } = useAtlasAuth();
  const identity = useFedizenIdentity();
  const fedizen = useMyFedizenProfile(identity.connected, () => { void identity.refresh(); });
  const remote = identity.connected ? fedizen.profile : null;
  const [name, setName] = useState('');
  const [bio, setBio] = useState(profile?.bio ?? '');
  const [website, setWebsite] = useState('');
  const [location, setLocation] = useState('');
  const [tags, setTags] = useState((profile?.featured_hashtags ?? []).map(t => `#${t}`).join(' '));
  const [saving, setSaving] = useState(false);

  // The sheet stays mounted at app level, so refresh the fields each time it opens (and once the profile arrives).
  useEffect(() => {
    if (opened) {
      setName(remote?.name ?? '');
      setBio(remote ? remote.bio : profile?.bio ?? '');
      setWebsite(remote?.website ?? '');
      setLocation(remote?.location ?? '');
      setTags((profile?.featured_hashtags ?? []).map(t => `#${t}`).join(' '));
    }
  }, [opened, remote]);

  const websiteOk = !website.trim() || isWebsite(website.trim());
  const save = async () => {
    setSaving(true);
    try {
      if (remote) {
        const r = await fedizen.save({ name: name.trim(), bio: bio.trim(), website: website.trim(), location: location.trim() });
        if (!r.ok) { f7.toast.show({ text: r.message, closeTimeout: 2400 }); return; }
        await updateProfile({ featured_hashtags: extractHashtags(tags) });
      } else {
        await updateProfile({ bio: bio.trim() || null, featured_hashtags: extractHashtags(tags) });
      }
      onClose();
    } catch {
      f7.toast.show({ text: 'Could not save — try again', closeTimeout: 1600 });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet opened={opened} onSheetClosed={onClose} backdrop style={{ height: 'auto', maxHeight: '90%' }} swipeToClose>
      <Block>
        <div style={{ fontWeight: 600, fontSize: 17, marginBottom: 4 }}>Edit profile</div>
        {identity.connected && !remote && <div style={{ fontSize: 13, opacity: 0.6 }}>{fedizen.loading ? 'Loading your Fedizen profile…' : fedizen.problem}</div>}
      </Block>
      {remote && <Block style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 0 }}>
        {(['avatar', 'banner'] as const).map(kind => <ProfileImagePicker key={kind} kind={kind} busy={fedizen.uploading === kind} onPick={file => fedizen.saveImage(kind, file)}
          button={(open, busy, label) => <Button tonal small round disabled={busy || !!fedizen.uploading} onClick={open}>{label}</Button>} />)}
      </Block>}
      <List strong inset>
        {remote && <ListInput type="text" label="Name" floatingLabel value={name} maxlength={NAME_MAX} onInput={(e: any) => setName(e.target.value)} />}
        <ListInput type="textarea" label="Bio" floatingLabel placeholder="Tell people what you share…" value={bio} maxlength={remote ? BIO_MAX : 300}
          onInput={(e: any) => setBio(e.target.value)} resizable />
        {remote && <ListInput type="url" label="Website" floatingLabel placeholder="example.org" value={website} maxlength={WEBSITE_MAX} inputmode="url"
          onInput={(e: any) => setWebsite(e.target.value)} errorMessage="Enter a web address, like example.org." errorMessageForce={!websiteOk} />}
        {remote && <ListInput type="text" label="Location" floatingLabel value={location} maxlength={LOCATION_MAX} onInput={(e: any) => setLocation(e.target.value)} />}
        <ListInput type="text" label="Featured hashtags" floatingLabel placeholder="#design #openweb" value={tags}
          onInput={(e: any) => setTags(e.target.value)} info={remote ? 'Separate with spaces. Kept in Atlas: Fedizen has no featured hashtags.' : 'Separate with spaces, like on Mastodon.'} />
      </List>
      <Block style={{ display: 'flex', gap: 8 }}>
        <Button tonal style={{ flex: 1 }} onClick={onClose}>Cancel</Button>
        <Button fill style={{ flex: 1 }} disabled={saving || (identity.connected && !remote) || (!!remote && (!name.trim() || !websiteOk))} onClick={save}>{saving ? 'Saving…' : 'Save'}</Button>
      </Block>
    </Sheet>
  );
}

/** The signed-in person's profile — the dock's avatar tab, laid out like a Bluesky profile: banner, avatar,
 *  Edit profile, name, handle, counts, bio, then the tab strip. */
export function ProfileView({ onEditProfile, onOpenCollection }: { onEditProfile: () => void; onOpenCollection: (c: Collection) => void }) {
  const { user, profile, signOut } = useAtlasAuth();
  const identity = useFedizenIdentity();
  const fedizen = useMyFedizenProfile(identity.connected);
  const remote = identity.connected ? fedizen.profile : null;
  const [section, setSection] = useState<Section>('Activity');
  const [filter, setFilter] = useState<ActivityFilter>(DEFAULT_ACTIVITY_FILTER);
  const empty = emptySections[section];
  const hasContent = (section === 'Featured' && (profile?.featured_hashtags ?? []).length > 0);
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
      {identity.viewer?.header && !/\/images\/bonfires\.png$/.test(identity.viewer.header)
        ? <img className="atlas-bsky-banner" src={identity.viewer.header} alt="" aria-hidden="true" referrerPolicy="no-referrer" style={{ objectFit: 'cover', width: '100%' }} />
        : <div className="atlas-bsky-banner" aria-hidden="true" />}
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
          <span><strong>{identity.counts?.following ?? '—'}</strong> following</span>
          <span><strong>{identity.counts?.posts ?? '—'}</strong> posts</span>
        </p>
        {remote ? <>
          {remote.bio && remote.bio.split(/\n{2,}/).map((para, i) => <p key={i} className="atlas-bsky-bio" style={{ whiteSpace: 'pre-line', overflowWrap: 'anywhere' }}>{linkifyHashtags(para)}</p>)}
          {(remote.location || remote.website) && <p className="atlas-bsky-meta">
            {remote.location && <span><Icon ios="f7:placemark" md="material:place" />{remote.location}</span>}
            {remote.website && isWebsite(remote.website) && <a className="external" target="_blank" rel="noopener noreferrer me" href={/^https?:/i.test(remote.website) ? remote.website : `https://${remote.website}`}><Icon ios="f7:link" md="material:link" />{remote.website.replace(/^https?:\/\//i, '').replace(/\/$/, '')}</a>}
          </p>}
        </> : identity.connected ? (fedizen.problem && <p className="atlas-bsky-bio atlas-profile-bio-empty">{fedizen.problem}</p>)
          : profile?.bio ? <p className="atlas-bsky-bio">{linkifyHashtags(profile.bio)}</p> : null}
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
        {section === 'Saved' && <MobileSaved />}
      </section>
      <footer className="atlas-profile-footer">
        <Button small onClick={() => { void signOut(); }}>Sign out</Button>
      </footer>

    </div>
  );
}
