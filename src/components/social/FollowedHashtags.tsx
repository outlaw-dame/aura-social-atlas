import { Link } from '@tanstack/react-router';
import { Tag } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { TagText, hashtagLabel } from '@/lib/hashtags';
import { useFollowedTagList, useTagFollow } from './useTagFollow';
import { Star } from 'lucide-react';
import { useFeatureTag } from './useFeatureTag';

const NEEDS: Record<string, string> = {
  'not-connected': 'Connect Fedizen to follow hashtags.',
  'needs-permission': 'Reconnect Fedizen so Atlas can read the hashtags you follow.',
  expired: 'Fedizen ended Atlas’s access. Connect again to see the hashtags you follow.',
  unavailable: 'Fedizen couldn’t send the hashtags you follow right now.',
};

/** Desktop Settings → Followed hashtags: Mastodon's list, each tag opening its feed, each with Unfollow. */
export function FollowedHashtags() {
  const q = useFollowedTagList();
  const f = useTagFollow();
  const names = q.data?.names ?? [];
  if (q.isLoading) return <p className="mt-8 text-sm text-muted-foreground">Loading…</p>;
  if (q.isError || q.data?.error) return <p className="mt-8 text-sm text-muted-foreground">{NEEDS[q.data?.error ?? 'unavailable']} {(q.isError || q.data?.error === 'unavailable') && <button type="button" className="underline" onClick={() => void q.refetch()}>Try again</button>}</p>;
  return <div className="mt-8">
    {f.error && <p role="alert" className="mb-4 text-sm text-destructive">{f.error}</p>}
    {!names.length ? <p className="text-sm text-muted-foreground">You don’t follow any hashtags yet. Follow one from its page.</p>
      : <ul className="divide-y divide-border border-y border-border">
        {names.map(n => {
          const lower = n.toLowerCase();
          return <li key={lower} className="flex items-center gap-3 py-3">
            <Tag className="size-4 text-muted-foreground" aria-hidden="true" />
            <Link to="/tags/$tag" params={{ tag: lower }} className="atlas-hashtag flex-1 font-medium" aria-label={hashtagLabel(n)}><TagText tag={n} /></Link>
            <Button variant="outline" size="sm" disabled={f.busy === lower} onClick={() => void f.toggle(n, false)}>Unfollow</Button>
          </li>;
        })}
      </ul>}
    {q.data?.full && <p className="mt-3 text-xs text-muted-foreground">Showing the first 200.</p>}
  </div>;
}

/** The Follow / Following button on a hashtag's page (desktop), as Mastodon puts it in the hashtag's header. */
export function FollowTagButton({ tag, following }: { tag: string; following: boolean }) {
  const f = useTagFollow();
  return <div className="flex flex-col items-start gap-1">
    <Button variant={following ? 'outline' : 'default'} size="sm" aria-pressed={following} disabled={!!f.busy} onClick={() => void f.toggle(tag, !following)}>
      {following ? 'Following' : 'Follow'}
    </Button>
    {f.error && <p role="alert" className="text-xs text-destructive">{f.error}</p>}
  </div>;
}

/** Desktop: Feature / Featured on a hashtag's page — it shows on your profile's Featured tab. */
export function FeatureTagButton({ tag }: { tag: string }) {
  const f = useFeatureTag(tag);
  if (!f.available) return null;
  return <div className="flex flex-col items-end gap-1">
    <Button variant="ghost" size="sm" className="rounded-full" aria-pressed={f.featured} disabled={f.busy} onClick={() => void f.toggle()}
      title={f.featured ? 'Remove from your profile' : 'Show on your profile'}>
      <Star className={f.featured ? 'fill-current text-accent' : ''} />{f.featured ? 'Featured' : 'Feature'}
    </Button>
    {f.error && <p role="alert" className="max-w-56 text-right text-xs text-destructive">{f.error}</p>}
  </div>;
}

