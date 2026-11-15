import { Card, CardContent, CardFooter, Link } from 'framework7-react';
import type { FedizenPost } from '@/lib/fedizen-feed';
import type { ForYouReason } from '@/lib/feed-types';
import { openCollection } from '@/lib/collections';
import { VideoPlayer } from '@/components/social/VideoPlayer';
import type { useSaveToggle } from '@/components/social/useFedizenLibrary';
import { SaveLink } from './SavedAndCircles';
import { ArticleCard } from './ArticleAuthors';
import { Icon } from './F7Extras';

const when = (d?: string) => d ? new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '';

/** Phone: why a post is in For You. */
export function MobileReasonChips({ reasons }: { reasons?: ForYouReason[] }) {
  if (!reasons?.length) return null;
  return <p className="atlas-reasons">{reasons.map((r, i) => <span key={i}>
    {r.kind === 'tag' ? <><Icon ios="f7:number" md="material:tag" />{r.tag}</> : r.kind === 'group' ? <><Icon ios="f7:bubble_left_bubble_right" md="material:forum" />Popular in {r.group}</> : <><Icon ios="f7:person_crop_circle_badge_checkmark" md="material:how_to_reg" />You follow</>}
  </span>)}</p>;
}

/** Phone: one post in a feed, with the standard post actions. */
export function MobilePostCard({ post: p, save, reasons }: { post: FedizenPost; save: ReturnType<typeof useSaveToggle>; reasons?: ForYouReason[] }) {
  return <Card outline>
    <CardContent>
      <MobileReasonChips reasons={reasons} />
      {p.boostedBy && <p style={{ fontSize: 11, opacity: .6, marginTop: 0 }}>↻ {p.boostedBy} boosted</p>}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 }}>{p.avatar && <img src={p.avatar} alt="" width={32} height={32} style={{ borderRadius: 16 }} referrerPolicy="no-referrer" />}<span><b>{p.author}</b> <span style={{ opacity: .6 }}>{p.handle}</span></span></div>
      {p.paragraphs.map((t, i) => <p key={i} style={{ lineHeight: 1.5 }}>{t}</p>)}
      {p.video ? <VideoPlayer video={p.video} /> : p.image && <img src={p.image} alt="" loading="lazy" style={{ width: '100%', borderRadius: 12 }} referrerPolicy="no-referrer" />}
      {p.collections?.map(link => <button key={link} type="button" className="atlas-coll-link" onClick={() => openCollection(link)}>
        <Icon ios="f7:square_stack_3d_up" md="material:collections_bookmark" /><span><b>Collection</b><small>{new URL(link).hostname}</small></span><Icon ios="f7:chevron_right" md="material:chevron_right" />
      </button>)}
      <ArticleCard article={p.article} />
    </CardContent>
    <CardFooter><span style={{ fontSize: 12, opacity: .6 }}>{when(p.date)}</span><span style={{ display: 'flex', gap: 12 }}>{p.statusId && <SaveLink post={p} save={save} />}<Link external target="_blank" href={p.url}>Open</Link></span></CardFooter>
  </Card>;
}
