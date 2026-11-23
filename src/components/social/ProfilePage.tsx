import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import { Bookmark, CalendarDays, Heart, Check, CircleDashed, CircleUserRound, Image, Link2, MapPin, PenLine, Star, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAtlasAuth } from './AuthState';
import { IdentityAvatar } from './IdentityAvatar';
import { useFedizenIdentity } from './useFedizenIdentity';
import { useMyFedizenProfile } from './useMyFedizenProfile';
import { ProfileImagePicker } from './ProfileImagePicker';
import { BIO_MAX, isWebsite, LOCATION_MAX, NAME_MAX, WEBSITE_MAX } from '@/lib/fedizen-profile';
import { extractHashtags, hashtagLabel, hashtagUrl, linkifyHashtags, TagText } from '@/lib/hashtags';
import { DesktopCollections } from './CollectionsDesktop';
import { DesktopCircles, DesktopLiked, DesktopSaved } from './SavedAndCircles';
import type { Collection } from '@/lib/collections';
import { activityLabel, DEFAULT_ACTIVITY_FILTER, profileSections, type ActivityFilter, type ProfileSection } from './profile-sections';

/* Desktop profile, laid out like a Bluesky profile (as the phone app's ProfileView): banner, avatar, Edit profile,
   name, handle, counts (Following opens the list of follows — not a tab), bio, featured hashtags, then tabs.
   Saved is the owner-only tab, like Bluesky's private Likes. */
const empty: Record<ProfileSection, { icon: typeof PenLine; title: string; detail: string }> = {
  Activity: { icon: PenLine, title: 'No activity yet', detail: 'Your public posts, quote posts, replies and boosts on Fedizen will appear here.' },
  Featured: { icon: Star, title: 'Nothing featured yet', detail: 'Feature hashtags from Edit profile, and people from their profiles, to show them here.' },
  Media: { icon: Image, title: 'No media yet', detail: 'Photos and videos you share will appear here.' },
  Collections: { icon: Image, title: 'No collections yet', detail: '' },
  Saved: { icon: Bookmark, title: 'Nothing saved yet', detail: 'Posts you save on Fedizen. Each keeps the audience its author chose.' },
  Liked: { icon: Heart, title: 'No likes yet', detail: 'Posts you like will be here.' },
  Circles: { icon: CircleDashed, title: 'No circles yet', detail: 'Circles group the people you know, like colleagues, friends or locals, so you choose who sees and replies to each post. Circles you make on Fedizen will appear here.' },
};

function Empty({ icon: Icon, title, detail, children }: { icon: typeof PenLine; title: string; detail: string; children?: React.ReactNode }) {
  return <div className="py-16 text-center"><Icon className="mx-auto mb-4 size-8 text-muted-foreground" strokeWidth={1.5} /><h3 className="font-serif text-2xl">{title}</h3><p className="mx-auto mt-3 max-w-xs text-sm text-muted-foreground">{detail}</p>{children}</div>;
}

function Dialog({ label, onClose, children }: { label: string; onClose: () => void; children: React.ReactNode }) {
  return <div className="social-backdrop fixed inset-0 z-[60] grid place-items-center px-5" onClick={onClose}>
    <section role="dialog" aria-modal="true" aria-label={label} className="specular w-full max-w-md rounded-3xl border border-border bg-card p-6 text-card-foreground" onClick={e => e.stopPropagation()}
      onKeyDown={e => { if (e.key === 'Escape') onClose(); }}>
      <div className="mb-4 flex items-center justify-between"><h2 className="font-serif text-2xl">{label}</h2><Button variant="ghost" size="icon" aria-label="Close" onClick={onClose}><X /></Button></div>
      {children}
    </section>
  </div>;
}

const field = 'w-full rounded-xl border border-border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring';

function EditProfileDialog({ onClose, fedizen }: { onClose: () => void; fedizen: ReturnType<typeof useMyFedizenProfile> | null }) {
  const { profile, updateProfile } = useAtlasAuth();
  // With Fedizen connected, name, bio, website and location are your Fedizen profile; featured hashtags stay Atlas's.
  const remote = fedizen?.profile ?? null;
  const [name, setName] = useState(remote?.name ?? '');
  const [bio, setBio] = useState(remote ? remote.bio : profile?.bio ?? '');
  const [website, setWebsite] = useState(remote?.website ?? '');
  const [location, setLocation] = useState(remote?.location ?? '');
  const [tags, setTags] = useState((profile?.featured_hashtags ?? []).map(t => `#${t}`).join(' '));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bioMax = remote ? BIO_MAX : 300;
  const websiteOk = !website.trim() || isWebsite(website.trim());
  const save = async () => {
    setSaving(true); setError(null);
    try {
      if (remote && fedizen) {
        const r = await fedizen.save({ name: name.trim(), bio: bio.trim(), website: website.trim(), location: location.trim() });
        if (!r.ok) { setError(r.message); return; }
        await updateProfile({ featured_hashtags: extractHashtags(tags) });
      } else {
        await updateProfile({ bio: bio.trim() || null, featured_hashtags: extractHashtags(tags) });
      }
      onClose();
    } catch { setError('Couldn’t save. Try again.'); }
    finally { setSaving(false); }
  };
  return <Dialog label="Edit profile" onClose={onClose}>
    {fedizen?.problem && !remote && <p role="status" className="mb-4 text-xs text-muted-foreground">{fedizen.problem}</p>}
    {remote && fedizen && <div className="mb-4 grid grid-cols-2 gap-3">
      {(['avatar', 'banner'] as const).map(kind => <ProfileImagePicker key={kind} kind={kind} busy={fedizen.uploading === kind} onPick={file => fedizen.saveImage(kind, file)}
        button={(open, busy, label) => <Button type="button" variant="outline" size="sm" className="w-full rounded-full" disabled={busy || !!fedizen.uploading} onClick={open}>{label}</Button>} />)}
    </div>}
    {remote && <>
      <label className="mb-1 block text-xs font-medium" htmlFor="profile-name">Name</label>
      <input id="profile-name" value={name} maxLength={NAME_MAX} onChange={e => setName(e.target.value)} className={`${field} h-10`} />
    </>}
    <label className={`mb-1 block text-xs font-medium ${remote ? 'mt-4' : ''}`} htmlFor="profile-bio">Bio</label>
    <textarea id="profile-bio" value={bio} maxLength={bioMax} onChange={e => setBio(e.target.value)} placeholder="Tell people what you share…" className={`${field} h-28 resize-none p-3`} />
    <p className="mb-3 text-right text-[11px] text-muted-foreground">{bio.length}/{bioMax.toLocaleString()}</p>
    {remote && <div className="grid gap-4 sm:grid-cols-2">
      <div>
        <label className="mb-1 block text-xs font-medium" htmlFor="profile-website">Website</label>
        <input id="profile-website" value={website} maxLength={WEBSITE_MAX} inputMode="url" autoComplete="url" onChange={e => setWebsite(e.target.value)} placeholder="example.org" aria-invalid={!websiteOk} className={`${field} h-10`} />
        {!websiteOk && <p className="mt-1 text-[11px] text-destructive">Enter a web address, like example.org.</p>}
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium" htmlFor="profile-location">Location</label>
        <input id="profile-location" value={location} maxLength={LOCATION_MAX} onChange={e => setLocation(e.target.value)} className={`${field} h-10`} />
      </div>
    </div>}
    <label className={`mb-1 block text-xs font-medium ${remote ? 'mt-4' : ''}`} htmlFor="profile-tags">Featured hashtags</label>
    <input id="profile-tags" value={tags} onChange={e => setTags(e.target.value)} placeholder="#design #openweb" className={`${field} h-10`} />
    <p className="mt-1 text-[11px] text-muted-foreground">Separate with spaces, like on Mastodon.{remote ? ' Kept in Atlas: Fedizen has no featured hashtags.' : ''}</p>
    {error && <p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}
    <div className="mt-6 flex justify-end gap-2"><Button variant="ghost" onClick={onClose}>Cancel</Button><Button disabled={saving || (!!remote && (!name.trim() || !websiteOk))} onClick={save}>{saving ? 'Saving…' : 'Save'}</Button></div>
  </Dialog>;
}

export function ProfilePage({ initialSection = 'Activity', onOpenCollection }: { initialSection?: ProfileSection; onOpenCollection: (c: Collection) => void }) {
  const { user, profile, loading, signOut } = useAtlasAuth();
  const identity = useFedizenIdentity();
  const fedizen = useMyFedizenProfile(identity.connected, () => { void identity.refresh(); });
  const remote = fedizen.profile;
  const [section, setSection] = useState<ProfileSection>(initialSection);
  const [filter, setFilter] = useState<ActivityFilter>(DEFAULT_ACTIVITY_FILTER);
  const [editing, setEditing] = useState(false);

  if (loading) return <div className="h-64" aria-busy="true" />;
  if (!user) return <Empty icon={CircleUserRound} title="Your profile" detail="Sign in to set up your profile and save stories to come back to.">
    <Button asChild className="mt-5"><Link to="/auth">Sign in</Link></Button>
  </Empty>;

  const name = identity.name;
  const featured = profile?.featured_hashtags ?? [];
  const e = empty[section];

  return <div className="animate-float-up">
    {identity.viewer?.header && !/\/images\/bonfires\.png$/.test(identity.viewer.header)
      ? <img src={identity.viewer.header} alt="" aria-hidden="true" referrerPolicy="no-referrer" className="h-36 w-full rounded-3xl object-cover sm:h-44" />
      : <div className="h-36 rounded-3xl sm:h-44" aria-hidden="true" style={{ background: 'linear-gradient(135deg, color-mix(in oklab, var(--accent) 30%, var(--card)), color-mix(in oklab, var(--accent) 8%, var(--card)))' }} />}
    <header className="px-2 sm:px-6">
      <div className="-mt-12 flex items-end justify-between">
        <IdentityAvatar className="size-24 atlas-avatar border-4 border-background object-cover" src={identity.avatar} name={identity.name} alt="Your profile avatar" />
        <Button variant="outline" className="mb-1 rounded-full" disabled={identity.connected && fedizen.loading} onClick={() => setEditing(true)}>Edit profile</Button>
      </div>
      <h1 className="mt-3 font-serif text-4xl leading-tight [overflow-wrap:anywhere]">{name}</h1>
      <p className="mt-1 text-sm text-muted-foreground [overflow-wrap:anywhere]">{identity.handle}</p>
      {identity.viewer?.profileUrl && <a href={identity.viewer.profileUrl} target="_blank" rel="noopener noreferrer" className="mt-1 inline-block text-xs text-accent hover:underline">View your verified Fedizen profile</a>}
      {identity.isFedizen && !identity.viewer && <p className="mt-2 text-xs text-muted-foreground">Fedizen's account details are unavailable or have not yet been verified. No substitute profile picture is shown.</p>}
      <p className="mt-3 flex flex-wrap gap-4 text-sm text-muted-foreground">
        <span><strong className="mr-1 font-semibold text-foreground">{identity.counts?.followers ?? '—'}</strong>followers</span>
        <span><strong className="mr-1 font-semibold text-foreground">{identity.counts?.following ?? '—'}</strong>following</span>
        <span><strong className="mr-1 font-semibold text-foreground">{identity.counts?.posts ?? '—'}</strong>posts</span>
      </p>
      {remote ? <>
        {remote.bio && <div className="mt-3 max-w-2xl space-y-2 text-sm leading-relaxed">{remote.bio.split(/\n{2,}/).map((para, i) => <p key={i} className="whitespace-pre-line [overflow-wrap:anywhere]">{linkifyHashtags(para)}</p>)}</div>}
        {(remote.location || remote.website) && <p className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {remote.location && <span className="flex items-center gap-1"><MapPin className="size-3.5" />{remote.location}</span>}
          {remote.website && isWebsite(remote.website) && <a href={/^https?:/i.test(remote.website) ? remote.website : `https://${remote.website}`} target="_blank" rel="noopener noreferrer me" className="flex items-center gap-1 text-accent hover:underline [overflow-wrap:anywhere]"><Link2 className="size-3.5" />{remote.website.replace(/^https?:\/\//i, '').replace(/\/$/, '')}</a>}
        </p>}
      </> : identity.connected ? (fedizen.problem && <p className="mt-3 text-xs text-muted-foreground">{fedizen.problem}</p>)
        : profile?.bio ? <p className="mt-3 max-w-2xl text-sm leading-relaxed">{linkifyHashtags(profile.bio)}</p> : null}
      {profile?.created_at && <p className="mt-3 flex items-center gap-1 text-xs text-muted-foreground"><CalendarDays className="size-3.5" />Atlas account created {new Date(profile.created_at).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</p>}
    </header>

    <div role="tablist" aria-label="Profile sections" className="sticky top-16 z-10 mt-6 flex overflow-x-auto border-b border-border bg-background/80 backdrop-blur-xl [scrollbar-width:none]">
      {profileSections.map(s => <button key={s} type="button" role="tab" id={`profile-tab-${s.toLowerCase()}`} aria-selected={section === s} aria-controls="profile-panel" onClick={() => setSection(s)}
        className={`relative inline-flex min-h-11 shrink-0 items-center gap-1 px-4 text-sm font-semibold transition-colors ${section === s ? 'text-foreground after:absolute after:inset-x-4 after:bottom-0 after:h-[3px] after:rounded-full after:bg-accent' : 'text-muted-foreground hover:text-foreground'}`}>
        {s}
      </button>)}
    </div>

    <section id="profile-panel" role="tabpanel" aria-labelledby={`profile-tab-${section.toLowerCase()}`} className="pt-8">
      {section === 'Activity' && identity.isFedizen && <p className="mb-4 text-sm text-muted-foreground">Your Fedizen identity and counts are live. This profile's activity panel is not yet synced; use <Link to="/feeds" className="text-accent underline">Following</Link> to view your authorized feed.</p>}
      {section === 'Activity' && <div className="mb-6 flex flex-wrap items-center gap-2" role="group" aria-label="Show in Activity">
        <span className="mr-1 text-xs text-muted-foreground">Showing {activityLabel(filter)}</span>
        {(['replies', 'boosts'] as const).map(k => <Button key={k} size="sm" variant="ghost" aria-pressed={filter[k]} onClick={() => setFilter(f => ({ ...f, [k]: !f[k] }))}
          className={`rounded-full ${filter[k] ? 'social-selected' : 'text-muted-foreground'}`}>{filter[k] && <Check />}{k === 'replies' ? 'Replies' : 'Boosts'}</Button>)}
      </div>}
      {section === 'Featured' && (featured.length > 0 ? <div className="space-y-8">
        <div><h2 className="mb-3 text-[10px] font-semibold uppercase text-muted-foreground">Hashtags</h2>
          <div className="flex flex-wrap gap-2" aria-label="Featured hashtags">{featured.map(t => <a key={t} className="atlas-profile-tag" href={hashtagUrl(t)} aria-label={hashtagLabel(t)}><TagText tag={t} /></a>)}</div></div>
        <div><h2 className="mb-3 text-[10px] font-semibold uppercase text-muted-foreground">Profiles</h2>
          <p className="text-sm text-muted-foreground">People you feature from their profiles on Fedizen will appear here.</p></div>
      </div> : <Empty icon={e.icon} title={e.title} detail={e.detail} />)}
      {section === 'Collections' && <DesktopCollections onOpen={onOpenCollection} />}
      {section === 'Circles' && <DesktopCircles />}
      {section === 'Liked' && <DesktopLiked />}
      {section === 'Saved' && <DesktopSaved />}
      {!['Featured', 'Collections', 'Saved', 'Liked', 'Circles'].includes(section) && <Empty icon={e.icon} title={e.title} detail={e.detail} />}
    </section>
    <footer className="mt-10 border-t border-border pt-5"><Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => { void signOut(); }}>Sign out</Button></footer>

    {editing && <EditProfileDialog onClose={() => setEditing(false)} fedizen={identity.connected ? fedizen : null} />}
  </div>;
}
