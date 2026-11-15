import type { ReactNode } from 'react';

// Mastodon hashtag rules: letters, digits and underscore (incl. non-ASCII word
// chars), but a tag may not be all digits. Boundary rules match Mastodon's
// extractor: a tag must not be preceded by a word char or /, &, +, -.
const HASHTAG_RE = /(^|[^\w/+&-])#([\p{L}\p{N}_]*[\p{L}_][\p{L}\p{N}_]*)/gu;

export function hashtagUrl(tag: string) {
  return `/tags/${encodeURIComponent(tag)}`;
}

/** Splits text into plain runs and hashtag tokens. */
function splitHashtags(text: string): (string | { tag: string })[] {
  const out: (string | { tag: string })[] = [];
  let last = 0;
  for (const match of text.matchAll(HASHTAG_RE)) {
    const start = match.index ?? 0;
    const boundary = match[1];
    const tag = match[2];
    const tagStart = start + boundary.length;
    if (tagStart > last) out.push(text.slice(last, tagStart));
    out.push({ tag });
    last = tagStart + tag.length + 1;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/**
 * How a posted hashtag reads, as Threads shows topics: the word alone, linked in the accent colour. People still type
 * the # in the composer and in text fields; once posted it isn't drawn. It stays in the text, visually hidden, so
 * copying a post keeps its hashtags, and screen readers hear "Hashtag …" from the control's label instead.
 */
export function TagText({ tag }: { tag: string }) {
  return <><span className="atlas-hashtag-mark">#</span>{tag}</>;
}
export const hashtagLabel = (tag: string) => `Hashtag ${tag}`;

/** Splits text into plain runs and hashtag links, Mastodon-style. */
export function linkifyHashtags(text: string): ReactNode[] {
  return splitHashtags(text).map((part, i) =>
    typeof part === 'string' ? part : (
      <a key={i} href={hashtagUrl(part.tag)} className="atlas-hashtag" aria-label={hashtagLabel(part.tag)} onClick={e => e.stopPropagation()}>
        <TagText tag={part.tag} />
      </a>
    ),
  );
}

/**
 * Like linkifyHashtags (and drawn the same way, without the #), but tags are in-app buttons calling onTag with the
 * normalized tag name. Clicks stop propagation so they work inside rows and
 * cards that have their own onClick.
 */
export function linkifyHashtagsWith(text: string, onTag: (tag: string) => void): ReactNode[] {
  return splitHashtags(text).map((part, i) =>
    typeof part === 'string' ? part : (
      <button
        key={i}
        type="button"
        className="atlas-hashtag atlas-hashtag-btn"
        aria-label={hashtagLabel(part.tag)}
        onClick={e => { e.stopPropagation(); onTag(part.tag.toLowerCase()); }}
      >
        <TagText tag={part.tag} />
      </button>
    ),
  );
}

/** Extracts normalized hashtag names (lowercased, no #) from free text. */
export function extractHashtags(text: string): string[] {
  const tags: string[] = [];
  for (const match of text.matchAll(HASHTAG_RE)) {
    const tag = match[2].toLowerCase();
    if (!tags.includes(tag)) tags.push(tag);
  }
  return tags;
}

/* ── Opening a hashtag's feed from a post (phone) ──────────────────────────────────────────────────── */

export const OPEN_TAG_EVENT = 'atlas:open-tag';
/** Asks the phone app to open a hashtag's feed. Tags are Mastodon's word characters only. */
export function openTag(tag: string): void {
  const t = tag.replace(/^#/, '').toLowerCase();
  if (typeof window === 'undefined' || !/^[\p{L}\p{N}_]{1,100}$/u.test(t)) return;
  window.dispatchEvent(new CustomEvent<{ tag: string }>(OPEN_TAG_EVENT, { detail: { tag: t } }));
}

/** The followed hashtags a post uses, in the order it uses them (Ivory shows the first at the top of the post). */
export function followedTagsIn(paragraphs: string[], followed: ReadonlySet<string>): string[] {
  if (!followed.size) return [];
  return extractHashtags(paragraphs.join('\n')).filter(t => followed.has(t));
}
