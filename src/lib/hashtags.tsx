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

/** Splits text into plain runs and hashtag links, Mastodon-style. */
export function linkifyHashtags(text: string): ReactNode[] {
  return splitHashtags(text).map((part, i) =>
    typeof part === 'string' ? part : (
      <a key={i} href={hashtagUrl(part.tag)} className="atlas-hashtag" onClick={e => e.stopPropagation()}>
        #{part.tag}
      </a>
    ),
  );
}

/**
 * Like linkifyHashtags, but tags are in-app buttons calling onTag with the
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
        onClick={e => { e.stopPropagation(); onTag(part.tag.toLowerCase()); }}
      >
        #{part.tag}
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
