/**
 * Mentions in a reply, as iMessage does them: typing "@" and a few letters offers people; picking one puts their
 * handle in the text and marks it, so it reads as a person rather than as typing. Browser-safe and pure.
 */

/** What's being typed after "@" at the caret: where the "@" is and the text after it. Null when not in a mention. */
export function mentionQueryAt(text: string, caret: number): { start: number; query: string } | null {
  const before = text.slice(0, caret);
  const m = /(^|[\s(])@([A-Za-z0-9_.-]{0,64}(?:@[A-Za-z0-9.-]{0,253})?)$/.exec(before);
  if (!m) return null;
  return { start: caret - m[2].length - 1, query: m[2] };
}

/** How a handle is written in the text: Fedizen's own people short ("@ana"), everyone else in full ("@ana@host"). */
export function mentionToken(handle: string, home = 'fedizen.net'): string {
  const h = handle.trim().replace(/^@/, '');
  return `@${h.toLowerCase().endsWith(`@${home}`) ? h.slice(0, -(home.length + 1)) : h}`;
}

/** Replaces the "@query" at `start..caret` with the person's token and a space; returns the new text and caret. */
export function insertMention(text: string, start: number, caret: number, handle: string): { text: string; caret: number } {
  const token = `${mentionToken(handle)} `;
  const after = text.slice(caret).replace(/^\S*/, ''); // the rest of a half-typed word goes too
  const next = text.slice(0, start) + token + after.replace(/^ /, '');
  return { text: next, caret: start + token.length };
}

/** The text cut into plain runs and the confirmed mentions in it (whole tokens only), for drawing the highlight. */
export function mentionSegments(text: string, confirmed: Iterable<string>): { text: string; mention: boolean }[] {
  const tokens = [...new Set([...confirmed].filter(Boolean))].sort((a, b) => b.length - a.length);
  if (!tokens.length) return [{ text, mention: false }];
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(^|[\\s(])(${tokens.map(esc).join('|')})(?=$|[\\s.,!?;:)])`, 'gi');
  const out: { text: string; mention: boolean }[] = [];
  let last = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const at = m.index + m[1].length;
    if (at > last) out.push({ text: text.slice(last, at), mention: false });
    out.push({ text: m[2], mention: true });
    last = at + m[2].length;
  }
  if (last < text.length) out.push({ text: text.slice(last), mention: false });
  return out;
}

/** Local suggestions first (the person being replied to), then search results, one per handle, at most `max`. */
export function mergeSuggestions<P extends { handle: string }>(query: string, local: P[], found: P[], max = 3): P[] {
  const q = query.toLowerCase();
  const matches = (p: P & { name?: string }) => !q || p.handle.toLowerCase().replace(/^@/, '').startsWith(q) || (p.name ?? '').toLowerCase().split(/\s+/).some(w => w.startsWith(q));
  const seen = new Set<string>();
  return [...local.filter(matches), ...found].filter(p => { const k = p.handle.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, max);
}

/** What's being typed after "#" at the caret (at least one letter), like Mastodon's composer. Null otherwise — and
 *  inside a URL fragment ("page#top") or a word, a "#" isn't a hashtag. */
export function hashtagQueryAt(text: string, caret: number): { start: number; query: string } | null {
  const m = /(^|[^\p{L}\p{N}_&#/])#([\p{L}\p{N}_]{1,100})$/u.exec(text.slice(0, caret));
  return m ? { start: caret - m[2].length - 1, query: m[2] } : null;
}

/** Replaces the "#query" at `start..caret` with "#tag " (the rest of a half-typed word goes too). */
export function insertHashtag(text: string, start: number, caret: number, tag: string): { text: string; caret: number } {
  const token = `#${tag.replace(/^#/, '')} `;
  const after = text.slice(caret).replace(/^[\p{L}\p{N}_]*/u, '').replace(/^ /, '');
  return { text: text.slice(0, start) + token + after, caret: start + token.length };
}
