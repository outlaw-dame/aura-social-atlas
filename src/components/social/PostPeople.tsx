import { useState, type ReactNode } from 'react';
import { RefreshCw } from 'lucide-react';
import type { FediMention, FediPerson, FedizenPost } from '@/lib/fedizen-feed';
import { openFediProfile } from '@/lib/fedi-profile';
import { linkifyHashtagsWith } from '@/lib/hashtags';

/**
 * The people in a post — its author, who boosted it, whom it mentions — each opening their profile in Atlas
 * (openFediProfile → the profile dialog on desktop, the profile sheet on the phone), never their server's page.
 */

/** "@name" or "@name@server", not inside a word, an e-mail address or a URL path. */
const MENTION = /(^|[^\w@/])@([a-z0-9_.~-]+(?:@[a-z0-9.-]+\.[a-z]{2,63})?)/gi;

/** Which of the post's mentions a written "@name" is: the full handle when written whole, else the one by that name. */
export function mentionFor(written: string, mentions: FediMention[]): FediMention | undefined {
  const w = written.toLowerCase();
  return w.includes('@') ? mentions.find(m => m.acct.toLowerCase() === w) : mentions.find(m => m.username.toLowerCase() === w);
}

/** A post's text with its mentions and hashtags as buttons. Only mentions Fedizen resolved become buttons. */
export function linkifyPost(text: string, mentions: FediMention[] | undefined, onTag: (tag: string) => void): ReactNode[] {
  if (!mentions?.length) return linkifyHashtagsWith(text, onTag);
  const out: ReactNode[] = [];
  let at = 0;
  for (const m of text.matchAll(MENTION)) {
    // A handle doesn't end in a dot or dash: "@nedley." is @nedley and a full stop.
    const written = m[2].replace(/[.~-]+$/, '');
    const hit = mentionFor(written, mentions);
    if (!hit) continue;
    const start = m.index! + m[1].length;
    if (start > at) out.push(...linkifyHashtagsWith(text.slice(at, start), onTag));
    out.push(<button key={`m${start}`} type="button" className="atlas-mention" aria-label={`Open the profile of ${hit.acct}`}
      onClick={e => { e.stopPropagation(); openFediProfile({ acct: hit.acct }); }}>@{written}</button>);
    at = start + 1 + written.length;
  }
  if (at < text.length) out.push(...linkifyHashtagsWith(text.slice(at), onTag));
  return out;
}

/** Whether Atlas can open this person's profile. */
export const canOpen = (p: { acct?: string; actor?: string }) => !!(p.acct || p.actor);

/** Opens the post author's profile in Atlas. */
export const openAuthor = (p: FedizenPost) => openFediProfile({ actor: p.actor, acct: p.acct, name: p.author });

function Face({ person, size }: { person: FediPerson; size: number }) {
  const [broken, setBroken] = useState(false);
  return person.avatar && !broken
    ? <img src={person.avatar} alt="" width={size} height={size} loading="lazy" referrerPolicy="no-referrer" onError={() => setBroken(true)} className="atlas-boost-face" />
    : <span aria-hidden="true" className="atlas-boost-face atlas-boost-initial">{person.name.charAt(0)}</span>;
}

/**
 * "[avatar] Name boosted" above a boosted post, with the boost button's own icon (PostActionBar's RefreshCw). The
 * name and avatar open the booster's profile. `className` styles the row for desktop or phone.
 */
export function BoostedBy({ post: p, className }: { post: FedizenPost; className: string }) {
  if (!p.boostedBy) return null;
  const who = p.booster ?? { name: p.boostedBy };
  const label = <><Face person={who} size={16} /><b>{who.name}</b></>;
  return <p className={className}>
    <RefreshCw aria-hidden="true" className="atlas-boost-icon" />
    {canOpen(who)
      ? <button type="button" className="atlas-boost-who" aria-label={`${who.name}, who boosted this. Open their profile`}
        onClick={e => { e.stopPropagation(); openFediProfile({ actor: who.actor, acct: who.acct, name: who.name }); }}>{label}</button>
      : <span className="atlas-boost-who">{label}</span>}
    <span>boosted</span>
  </p>;
}
