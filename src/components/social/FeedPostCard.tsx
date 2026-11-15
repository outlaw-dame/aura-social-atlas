import { ArrowUpRight, Hash, MessagesSquare, Repeat2, UserCheck } from 'lucide-react';
import type { FedizenPost } from '@/lib/fedizen-feed';
import type { ForYouReason } from '@/lib/feed-types';
import { CollectionLinks } from './CollectionsDesktop';
import { SaveButton } from './SavedAndCircles';
import { PostArticleCard } from './ArticleAuthors';
import { VideoPlayer } from './VideoPlayer';
import type { useSaveToggle } from './useFedizenLibrary';

const when = (d?: string) => d ? new Date(d).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';

/** Why a post is in For You, in a few words. */
export function ReasonChips({ reasons }: { reasons?: ForYouReason[] }) {
  if (!reasons?.length) return null;
  return <p className="mb-2 flex flex-wrap gap-1.5 text-[11px] text-muted-foreground">{reasons.map((r, i) =>
    <span key={i} className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5">
      {r.kind === 'tag' ? <><Hash className="size-3" />{r.tag}</> : r.kind === 'group' ? <><MessagesSquare className="size-3" />Popular in {r.group}</> : <><UserCheck className="size-3" />You follow</>}
    </span>)}</p>;
}

/** Desktop: one post in a feed, with the standard post actions. */
export function FeedPostCard({ post: p, save, reasons }: { post: FedizenPost; save: ReturnType<typeof useSaveToggle>; reasons?: ForYouReason[] }) {
  return <article className="border-b border-border pb-5">
    <ReasonChips reasons={reasons} />
    {p.boostedBy && <p className="mb-2 flex items-center gap-1 text-[11px] text-muted-foreground"><Repeat2 className="size-3" />{p.boostedBy} boosted</p>}
    <p className="flex items-center gap-2 text-xs">{p.avatar && <img src={p.avatar} alt="" loading="lazy" referrerPolicy="no-referrer" className="size-8 rounded-full object-cover" />}<span><span className="font-semibold">{p.author}</span> <span className="text-muted-foreground">{p.handle} · {when(p.date)}</span></span></p>
    <div className="mt-3 space-y-2 text-sm leading-relaxed">{p.paragraphs.map((t, i) => <p key={i}>{t}</p>)}</div>
    {p.video ? <VideoPlayer video={p.video} /> : p.image && <img src={p.image} alt="" loading="lazy" referrerPolicy="no-referrer" className="mt-3 max-h-80 w-full rounded-2xl object-cover" />}
    <CollectionLinks links={p.collections} />
    <PostArticleCard article={p.article} />
    <div className="mt-2 flex items-center gap-2">
      {p.statusId && <SaveButton post={p} save={save} />}
      <a href={p.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">Open on Fedizen<ArrowUpRight className="size-3" /></a>
    </div>
  </article>;
}
