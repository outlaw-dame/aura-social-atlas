/**
 * Other spellings of a followed hashtag, so following #PS5 also brings in #PS5Pro, #PlayStation5 and #PlayStation5Pro
 * without following each of them (their FediBuzz relays are followed behind the scenes: fedibuzz-follows.server.ts).
 *
 * A tag counts as a spelling of the followed one only when both hold:
 * - it's used together with the followed tag in recent public posts (at least MIN_TOGETHER of them), and
 * - its name is related: it starts or ends with the followed tag (#PS5Pro, #NewPS5), or its initials do
 *   (#PlayStation5 → P·S·5, #PlayStation5Pro → P·S·5·P), or the other way round (following #PlayStation5 brings #PS5).
 * Being used together alone isn't enough (#PS5 posts also say #Gaming, which is a different subject), and neither is a
 * similar name alone (#ps5 and #ps50 aren't the same subject unless people use them together).
 */
import { tagRelay } from './fedibuzz';

export const MIN_TOGETHER = 2;
export const MAX_VARIANTS = 6;
/** How much longer than the followed tag a prefix or suffix spelling may be (#PS5Pro: 3 more; #PS5Games: 5). */
const MAX_EXTRA = 6;

/** A hashtag's initials: its CamelCase words' first letters and its digits ("PlayStation5Pro" → "ps5p"). */
export function initials(cased: string): string {
  const parts = cased.match(/[A-Z]+(?![a-z])|[A-Z]?[a-z]+|\d+/g) ?? [];
  return parts.map(p => (/^\d+$/.test(p) ? p : p.length > 1 && p === p.toUpperCase() ? p.toLowerCase() : p[0]!.toLowerCase())).join('');
}

/** Whether `cand` (as written, any case) is a spelling of `followed` (as written). */
export function isSpelling(followed: string, cand: string): boolean {
  const f = followed.toLowerCase(), c = cand.toLowerCase();
  if (f === c || f.length < 2 || c.length < 2) return false;
  if (f.length >= 3 && (c.startsWith(f) || c.endsWith(f)) && c.length - f.length <= MAX_EXTRA) return true;
  const ci = initials(cand), fi = initials(followed);
  if (ci.length >= 2 && ci !== c && ci.startsWith(f) && ci.length - f.length <= 2) return true;
  if (fi.length >= 2 && fi !== f && fi.startsWith(c) && c.length >= 2) return true;
  // Written without capitals (#Playstation5): the shorter one's letters appear in order in the longer one, starting
  // with the same letter and ending with the same number (p·s·5 in playstation5).
  const [short, long] = f.length <= c.length ? [f, c] : [c, f];
  const num = /\d+$/.exec(short)?.[0];
  if (short.length >= 3 && num && long.endsWith(num) && short[0] === long[0] && inOrder(short, long)) return true;
  return false;
}

function inOrder(short: string, long: string): boolean {
  let i = 0;
  for (const ch of long) if (ch === short[i]) i++;
  return i === short.length;
}

/** The hashtags a text uses, as written. */
function tagsAsWritten(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/(^|[^\w/+&-])#([\p{L}\p{N}_]*[\p{L}_][\p{L}\p{N}_]*)/gu)) out.push(m[2]!);
  return out;
}

/**
 * The spellings of `followed` found in `posts` (each a post's text), most used first, at most MAX_VARIANTS, only ones
 * FediBuzz has a relay for exactly (tagRelay). Lowercase.
 */
export function findSpellings(followed: string, posts: string[], cased: string = followed): string[] {
  const f = followed.toLowerCase();
  const seen = new Map<string, { count: number; written: string }>();
  let writtenFollowed = cased;
  for (const text of posts) {
    const tags = tagsAsWritten(text);
    const own = tags.find(t => t.toLowerCase() === f);
    if (!own) continue;
    // How people write the followed tag (#PlayStation5, not #playstation5) tells its initials.
    if (own !== own.toLowerCase()) writtenFollowed = own;
    for (const t of new Set(tags.filter(x => x.toLowerCase() !== f))) {
      const k = t.toLowerCase();
      const e = seen.get(k) ?? { count: 0, written: t };
      e.count++;
      if (t !== k) e.written = t;
      seen.set(k, e);
    }
  }
  return [...seen.entries()]
    .filter(([k, e]) => e.count >= MIN_TOGETHER && !!tagRelay(k) && isSpelling(writtenFollowed, e.written))
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, MAX_VARIANTS)
    .map(([k]) => k);
}
