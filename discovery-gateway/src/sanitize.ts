/**
 * Untrusted remote HTML → plain text. The gateway stores and serves text only;
 * it never persists or returns markup, so no sanitizer allowlist is needed —
 * everything is stripped. Entities are decoded, whitespace collapsed, and the
 * result is length-capped.
 */

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', hellip: '…',
  mdash: '—', ndash: '–', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”',
};

export function decodeEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (whole, body: string) => {
    if (body[0] === '#') {
      const code = body[1]?.toLowerCase() === 'x' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return whole;
      try { return String.fromCodePoint(code); } catch { return whole; }
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? whole;
  });
}

/** Strip all tags, decode entities, collapse whitespace, cap length. */
export function htmlToText(html: string, maxLength: number): string {
  let text = html
    .replace(/<(script|style|noscript|template)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|blockquote|h[1-6]|tr)>/gi, '\n')
    .replace(/<[^>]*>/g, ' ');
  text = decodeEntities(text);
  text = text.replace(/[ \t\f\v]+/g, ' ').replace(/\n[ \t]+/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  if (text.length > maxLength) text = `${text.slice(0, maxLength - 1).trimEnd()}…`;
  return text;
}

/** Plain-text fields (names, summaries) still get entity decoding + caps. */
export function cleanText(text: string, maxLength: number): string {
  const out = decodeEntities(text).replace(/\s+/g, ' ').trim();
  return out.length > maxLength ? `${out.slice(0, maxLength - 1).trimEnd()}…` : out;
}

/** Extract hashtag names from an ActivityStreams tag array (already parsed JSON). */
export function hashtagNames(tags: unknown): string[] {
  // Compact JSON-LD can collapse a single `tag` value to an object.
  // Accept that shape without accepting primitive or arbitrary tag lists.
  const values = Array.isArray(tags) ? tags : tags && typeof tags === 'object' ? [tags] : [];
  const out: string[] = [];
  for (const t of values) {
    if (t && typeof t === 'object' && ((t as { type?: unknown }).type === 'Hashtag' || (t as { type?: unknown }).type === 'https://www.w3.org/ns/activitystreams#Hashtag')) {
      const name = (t as { name?: unknown }).name;
      if (typeof name === 'string') {
        const clean = name.replace(/^#/, '').trim().toLowerCase();
        if (/^[\p{L}\p{N}_-]{1,100}$/u.test(clean)) out.push(clean);
      }
    }
  }
  return [...new Set(out)];
}
