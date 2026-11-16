import { Fragment, useState, type ReactNode } from 'react';
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

/** A web address in a post's text. Fedizen's HTML is flattened to text first, so its links come back as written. */
const URL_RE = /\bhttps?:\/\/[^\s<>"]+/gi;

/** A link without what usually follows it in a sentence: closing punctuation, or a ")" it didn't open. */
export function trimUrl(raw: string): string {
  let u = raw;
  for (;;) {
    const before = u;
    u = u.replace(/[.,;:!?'"\u2019\u201d\u00bb]+$/u, '');
    if (u.endsWith(')') && (u.match(/\(/g) ?? []).length < (u.match(/\)/g) ?? []).length) u = u.slice(0, -1);
    if (u === before) return u;
  }
}

/** How a link reads in a post, as Mastodon shows it: no scheme or "www.", and long ones cut to 30 characters. */
export function shownUrl(href: string): string {
  const s = href.replace(/^https?:\/\//i, '').replace(/^www\./i, '');
  return s.length > 30 ? `${s.slice(0, 30)}…` : s;
}

/** A post's text with its links, mentions and hashtags live. Links open in a new tab; mentions (only those
 *  Fedizen resolved) open profiles in Atlas; hashtags open their feed in Atlas. */
export function linkifyPost(text: string, mentions: FediMention[] | undefined, onTag: (tag: string) => void): ReactNode[] {
  const out: ReactNode[] = [];
  let at = 0;
  for (const m of text.matchAll(URL_RE)) {
    const href = trimUrl(m[0]);
    let ok = false;
    try { ok = /^https?:$/.test(new URL(href).protocol); } catch { ok = false; }
    if (!ok) continue;
    const start = m.index!;
    if (start > at) out.push(<Fragment key={`p${at}`}>{linkifyPeople(text.slice(at, start), mentions, onTag)}</Fragment>);
    out.push(<a key={`u${start}`} href={href} target="_blank" rel="noopener noreferrer nofollow ugc" className="atlas-post-link" title={href}
      onClick={e => e.stopPropagation()}>{shownUrl(href)}</a>);
    at = start + href.length;
  }
  if (at < text.length) out.push(<Fragment key={`p${at}`}>{linkifyPeople(text.slice(at), mentions, onTag)}</Fragment>);
  return out;
}

/** Text with no links: mentions Fedizen resolved as profile buttons, hashtags as feed buttons. */
function linkifyPeople(text: string, mentions: FediMention[] | undefined, onTag: (tag: string) => void): ReactNode[] {
  if (!mentions?.length) return linkifyHashtagsWith(text, onTag);
  const out: ReactNode[] = [];
  let at = 0;
  for (const m of text.matchAll(MENTION)) {
    // A handle doesn't end in a dot or dash: "@nedley." is @nedley and a full stop.
    const written = m[2].replace(/[.~-]+$/, '');
    const hit = mentionFor(written, mentions);
    if (!hit) continue;
    const start = m.index! + m[1].length;
    // Each stretch of text in its own keyed fragment: linkifyHashtagsWith keys its tags by index, so two stretches'
    // tags would otherwise share keys.
    if (start > at) out.push(<Fragment key={`t${at}`}>{linkifyHashtagsWith(text.slice(at, start), onTag)}</Fragment>);
    out.push(<button key={`m${start}`} type="button" className="atlas-mention" aria-label={`Open the profile of ${hit.acct}`}
      onClick={e => { e.stopPropagation(); openFediProfile({ acct: hit.acct }); }}>@{written}</button>);
    at = start + 1 + written.length;
  }
  if (at < text.length) out.push(<Fragment key={`t${at}`}>{linkifyHashtagsWith(text.slice(at), onTag)}</Fragment>);
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
