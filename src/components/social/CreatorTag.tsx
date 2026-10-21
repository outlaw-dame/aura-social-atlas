import { UserPlus, UserCheck, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { avatarPreset } from '@/lib/atlas-avatars';
import { fullHandle, type Creator } from '@/lib/social-catalogue';
import { NetworkBadge } from '@/lib/networks';
import { useSocial } from './SocialState';

/** Article attribution opens the author without navigating away from the feed. */
export function CreatorTag({ creator, onOpen }: { creator: Creator; onOpen: () => void }) {
  const { followed, toggleFollow } = useSocial();
  const following = followed.includes(creator.id);
  return <div className="atlas-author-tag">
    <Button variant="ghost" className="atlas-author-profile hover:bg-muted hover:text-foreground active:bg-muted" aria-label={`View ${creator.name}'s profile`} onClick={onOpen}>
      <img src={avatarPreset(creator.avatar_key).src} width={36} height={36} alt="" />
      <span className="atlas-author-copy">
        <span className="atlas-author-name"><small>By</small> {creator.name}{creator.bot && <small className="atlas-follows-you">Bot</small>}</span>
        <span className="atlas-author-handle">{fullHandle(creator)}</span>
        <span className="atlas-author-network"><NetworkBadge network={creator.network} />{creator.follows_you && <span>Follows you</span>}</span>
      </span>
      <ChevronRight className="atlas-author-chevron" aria-hidden="true" />
    </Button>
    <Button variant="ghost" size="icon" className="atlas-author-follow hover:bg-muted hover:text-accent active:bg-muted" aria-label={`${following ? 'Unfollow' : 'Follow'} ${creator.name}`} aria-pressed={following} title={following ? 'Unfollow creator' : 'Follow creator'} onClick={() => toggleFollow(creator.id)}>
      {following ? <UserCheck /> : <UserPlus />}
    </Button>
  </div>;
}