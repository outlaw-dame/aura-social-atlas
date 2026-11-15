import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import { Bookmark, CalendarDays, CircleUserRound, Image, Layers, List, Lock, MessagesSquare, PenLine, Users, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAtlasAuth } from './AuthState';
import { useSocial } from './SocialState';
import { avatarPreset, defaultAvatarKey } from '@/lib/atlas-avatars';
import { creators, fullHandle, posts, type Creator } from '@/lib/social-catalogue';
import { extractHashtags, hashtagUrl, linkifyHashtags } from '@/lib/hashtags';
import { CreatorTag } from './CreatorTag';
import { profileSections, type ProfileSection } from './profile-sections';

/* Desktop profile, laid out like a Bluesky profile (as the phone app's ProfileView): banner, avatar, Edit profile,
   name, handle, counts (Following opens the list of follows — not a tab), bio, featured hashtags, then tabs.
   Saved is the owner-only tab, like Bluesky's private Likes. */
const empty: Record<ProfileSection, { icon: typeof PenLine; title: string; detail: string }> = {
  Posts: { icon: PenLine, title: 'No posts yet', detail: 'Your posts will appear here once publishing is connected.' },
  Replies: { icon: MessagesSquare, title: 'No replies yet', detail: 'Your replies will appear here once publishing is connected.' },
  Media: { icon: Image, title: 'No media yet', detail: 'Photos and videos you share will appear here.' },
  Saved: { icon: Bookmark, title: 'Nothing saved yet', detail: 'Stories you save appear here. Only you can see this tab.' },
  Feeds: { icon: Layers, title: 'No feeds yet', detail: 'Custom feeds you create will appear here.' },
  Lists: { icon: List, title: 'No lists yet', detail: 'Your creator lists will appear here when lists are available.' },
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

function EditProfileDialog({ onClose }: { onClose: () => void }) {
  const { profile, updateProfile } = useAtlasAuth();
  const [bio, setBio] = useState(profile?.bio ?? '');
  const [tags, setTags] = useState((profile?.featured_hashtags ?? []).map(t => `#${t}`).join(' '));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    setSaving(true); setError(null);
    try { await updateProfile({ bio: bio.trim() || null, featured_hashtags: extractHashtags(tags) }); onClose(); }
    catch { setError('Couldn’t save. Try again.'); }
    finally { setSaving(false); }
  };
  return <Dialog label="Edit profile" onClose={onClose}>
    <p className="mb-4 text-xs text-muted-foreground">Hashtags in your bio become links. Featured hashtags show on your profile like they do on Mastodon.</p>
    <label className="mb-1 block text-xs font-medium" htmlFor="profile-bio">Bio</label>
    <textarea id="profile-bio" value={bio} maxLength={300} onChange={e => setBio(e.target.value)} placeholder="Tell people what you share…" className="h-28 w-full resize-none rounded-xl border border-border bg-background p-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring" />
    <p className="mb-3 text-right text-[11px] text-muted-foreground">{bio.length}/300</p>
    <label className="mb-1 block text-xs font-medium" htmlFor="profile-tags">Featured hashtags</label>
    <input id="profile-tags" value={tags} onChange={e => setTags(e.target.value)} placeholder="#design #openweb" className="h-10 w-full rounded-xl border border-border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring" />
    <p className="mt-1 text-[11px] text-muted-foreground">Separate with spaces, like on Mastodon.</p>
    {error && <p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}
    <div className="mt-6 flex justify-end gap-2"><Button variant="ghost" onClick={onClose}>Cancel</Button><Button disabled={saving} onClick={save}>{saving ? 'Saving…' : 'Save'}</Button></div>
  </Dialog>;
}

export function ProfilePage({ initialSection = 'Posts', onOpenCreator }: { initialSection?: ProfileSection; onOpenCreator: (c: Creator) => void }) {
  const { user, profile, loading, signOut } = useAtlasAuth();
  const { followed, saved, toggleSave, toggleFollow } = useSocial();
  const [section, setSection] = useState<ProfileSection>(initialSection);
  const [followsOpen, setFollowsOpen] = useState(false);
  const [editing, setEditing] = useState(false);

  if (loading) return <div className="h-64" aria-busy="true" />;
  if (!user) return <Empty icon={CircleUserRound} title="Your profile" detail="Sign in to set up your profile and save stories to come back to.">
    <Button asChild className="mt-5"><Link to="/auth">Sign in</Link></Button>
  </Empty>;

  const name = profile?.display_name || 'Your profile';
  const featured = profile?.featured_hashtags ?? [];
  const savedPosts = posts.filter(p => saved.includes(p.id));
  const followedCreators = creators.filter(c => followed.includes(c.id));
  const e = empty[section];

  return <div className="animate-float-up">
    <div className="h-36 rounded-3xl sm:h-44" aria-hidden="true" style={{ background: 'linear-gradient(135deg, color-mix(in oklab, var(--accent) 30%, var(--card)), color-mix(in oklab, var(--accent) 8%, var(--card)))' }} />
    <header className="px-2 sm:px-6">
      <div className="-mt-12 flex items-end justify-between">
        <img className="size-24 rounded-full border-4 border-background bg-secondary object-cover" src={avatarPreset(profile?.avatar_key ?? defaultAvatarKey(user.id)).src} alt="Your avatar" width={96} height={96} />
        <Button variant="outline" className="mb-1 rounded-full" onClick={() => setEditing(true)}>Edit profile</Button>
      </div>
      <h1 className="mt-3 font-serif text-4xl leading-tight [overflow-wrap:anywhere]">{name}</h1>
      <p className="mt-1 text-sm text-muted-foreground [overflow-wrap:anywhere]">{user.email}</p>
      <p className="mt-3 flex flex-wrap gap-4 text-sm text-muted-foreground">
        <span><strong className="mr-1 font-semibold text-foreground">0</strong>followers</span>
        <button type="button" className="hover:text-foreground hover:underline" onClick={() => setFollowsOpen(true)}><strong className="mr-1 font-semibold text-foreground">{followed.length}</strong>following</button>
        <span><strong className="mr-1 font-semibold text-foreground">0</strong>posts</span>
      </p>
      {profile?.bio ? <p className="mt-3 max-w-2xl text-sm leading-relaxed">{linkifyHashtags(profile.bio)}</p>
        : <p className="mt-3 text-sm text-muted-foreground">No bio yet — add one so people know what you share.</p>}
      {featured.length > 0 && <div className="mt-3 flex flex-wrap gap-2" aria-label="Featured hashtags">{featured.map(t => <a key={t} className="atlas-profile-tag" href={hashtagUrl(t)}>#{t}</a>)}</div>}
      {profile?.created_at && <p className="mt-3 flex items-center gap-1 text-xs text-muted-foreground"><CalendarDays className="size-3.5" />Joined {new Date(profile.created_at).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</p>}
    </header>

    <div role="tablist" aria-label="Profile sections" className="sticky top-16 z-10 mt-6 flex overflow-x-auto border-b border-border bg-background/80 backdrop-blur-xl [scrollbar-width:none]">
      {profileSections.map(s => <button key={s} type="button" role="tab" id={`profile-tab-${s.toLowerCase()}`} aria-selected={section === s} aria-controls="profile-panel" onClick={() => setSection(s)}
        className={`relative inline-flex min-h-11 shrink-0 items-center gap-1 px-4 text-sm font-semibold transition-colors ${section === s ? 'text-foreground after:absolute after:inset-x-4 after:bottom-0 after:h-[3px] after:rounded-full after:bg-accent' : 'text-muted-foreground hover:text-foreground'}`}>
        {s === 'Saved' && <Lock className="size-3" aria-label="Private" />}{s}
      </button>)}
    </div>

    <section id="profile-panel" role="tabpanel" aria-labelledby={`profile-tab-${section.toLowerCase()}`} className="pt-8">
      {section === 'Saved' && savedPosts.length ? <div className="grid gap-x-6 gap-y-9 sm:grid-cols-2">{savedPosts.map(p => {
        const c = creators.find(x => x.id === p.creatorId);
        return <article key={p.id}>
          <a href={p.url} target="_blank" rel="noreferrer" className="group block overflow-hidden rounded-2xl"><img src={p.image} alt={p.alt} loading="lazy" className="aspect-[4/3] w-full object-cover transition-transform duration-700 group-hover:scale-[1.025]" /></a>
          <h3 className="mt-3 font-serif text-2xl leading-tight"><a href={p.url} target="_blank" rel="noreferrer">{p.title}</a></h3>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{p.excerpt}</p>
          {c && <CreatorTag creator={c} onOpen={() => onOpenCreator(c)} />}
          <Button variant="ghost" size="sm" className="mt-2 px-0 text-muted-foreground" onClick={() => toggleSave(p.id)}><Bookmark className="fill-accent text-accent" />Remove from saved</Button>
        </article>;
      })}</div> : <Empty icon={e.icon} title={e.title} detail={e.detail} />}
    </section>
    <footer className="mt-10 border-t border-border pt-5"><Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => { void signOut(); }}>Sign out</Button></footer>

    {followsOpen && <Dialog label="Following" onClose={() => setFollowsOpen(false)}>
      {followedCreators.length ? <ul className="max-h-[60vh] space-y-1 overflow-y-auto">{followedCreators.map(c => <li key={c.id} className="flex items-center gap-3 rounded-xl p-2 hover:bg-secondary/60">
        <button type="button" className="flex min-w-0 flex-1 items-center gap-3 text-left" onClick={() => { setFollowsOpen(false); onOpenCreator(c); }}>
          <img src={avatarPreset(c.avatar_key).src} alt="" className="social-avatar size-10 shrink-0" />
          <span className="min-w-0"><span className="block truncate text-sm font-semibold">{c.name}</span><span className="block truncate text-xs text-muted-foreground">{fullHandle(c)}</span></span>
        </button>
        <Button size="sm" variant="outline" className="rounded-full" onClick={() => toggleFollow(c.id)}>Following</Button>
      </li>)}</ul> : <Empty icon={Users} title="Not following anyone yet" detail="People you follow in Discover will appear here." />}
    </Dialog>}
    {editing && <EditProfileDialog onClose={() => setEditing(false)} />}
  </div>;
}
