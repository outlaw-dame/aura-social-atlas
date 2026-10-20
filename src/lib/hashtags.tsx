import type { ReactNode } from 'react';

// Mastodon hashtag rules: letters, digits and underscore (incl. non-ASCII word
// chars), but a tag may not be all digits. Boundary rules match Mastodon's
// extractor: a tag must not be preceded by a word char or /, &, +, -.
const HASHTAG_RE = /(^|[^\w/+&-])#([\p{L}\p{N}_]*[\p{L}_][\p{L}\p{N}_]*)/gu;

export function hashtagUrl(tag: string) {
  return `https://mastodon.social/tags/${encodeURIComponent(tag)}`;
}

/** Splits text into plain runs and hashtag links, Mastodon-style. */
export function linkifyHashtags(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let key = 0;
  for (const match of text.matchAll(HASHTAG_RE)) {
    const start = match.index ?? 0;
    const boundary = match[1];
    const tag = match[2];
    const tagStart = start + boundary.length;
    if (tagStart > last) out.push(text.slice(last, tagStart));
    out.push(
      <a key={key++} href={hashtagUrl(tag)} target="_blank" rel="noopener noreferrer" className="atlas-hashtag">
        #{tag}
      </a>,
    );
    last = tagStart + tag.length + 1;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
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
