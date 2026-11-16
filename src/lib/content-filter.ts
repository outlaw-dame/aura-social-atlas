/**
 * Keyword filters, Atlas's way. Browser-safe and pure, so the same rules run in every feed and in tests.
 *
 * Bonfire (ActivityPub.MRF.KeywordMatcher, Bonfire 1.1.0-rc.1) matches a keyword as a whole word, `*` lets it run into
 * a longer word, case doesn't matter and look-alike characters are folded. That syntax is kept here, so a list copied
 * from Fedizen means the same thing in Atlas. What made it lossy is fixed:
 * - Bonfire also folds "rn" into "m" everywhere, so `bum` hides "burn" and `com` hides "corn". Atlas folds only real
 *   look-alikes (Cyrillic/Greek letters, invisible characters, accents, digits inside words: C00L → cool).
 * - It reads the post's text, content warning and title only. Atlas also reads hashtags (#ClimateChange matches the
 *   phrase "climate change"), image descriptions and the link preview's title.
 * - A phrase must match word for word; Atlas lets spaces, hyphens and line breaks vary ("climate-change").
 * - It has no idea what a post is about. With Intelligence on, every match is checked in context by the person's own
 *   AI model, which also finds what the words miss (other wordings, other languages, a topic with no fixed words).
 */

export type FilterKind = 'word' | 'phrase' | 'hashtag' | 'topic';
export type FilterAction = 'hide' | 'warn';
export type ContentFilter = {
  id: string;
  /** What the person typed: a word (`spam*`), a phrase, a #hashtag, or a topic in plain words. */
  text: string;
  kind: FilterKind;
  action: FilterAction;
  /** Checked in context by the AI model (Intelligence on): false keeps it a plain keyword. */
  semantic: boolean;
  /** Other wordings the AI model found for it: matched like keywords, then checked in context. */
  expansions: string[];
};

/** What a filter needs from a post. */
export type FilterablePost = { id: string; statusId?: string; paragraphs: string[]; cw?: string; tags?: string[]; alt?: string[]; linkTitle?: string; visibility?: string };

// eslint-disable-next-line no-control-regex -- stripping control characters is the point
const CONTROL = new RegExp('[\\u0000-\\u001f\\u007f]', 'g');
export const MAX_FILTERS = 200;
export const MAX_FILTER_TEXT = 200;
export const MAX_EXPANSIONS = 24;

/** The kind of filter someone typed: a #hashtag, a single word, a short phrase, or a topic described in words. */
export function filterKind(raw: string): FilterKind {
  const t = raw.trim();
  if (/^#[\p{L}\p{N}_]+$/u.test(t)) return 'hashtag';
  const words = t.replace(/\*/g, '').split(/\s+/).filter(Boolean);
  if (words.length <= 1) return 'word';
  return words.length <= 4 ? 'phrase' : 'topic';
}

/** Cleans what someone typed into a filter's text, or null when nothing usable is left. */
export function normalizeFilterText(raw: string): string | null {
  const t = raw.normalize('NFC').replace(CONTROL, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_FILTER_TEXT);
  return t.replace(/[*#\s]/g, '') ? t : null;
}

/** Splits a pasted list (Fedizen's filter list, one per line or comma-separated) into filter texts, without repeats. */
export function parseFilterList(raw: string): string[] {
  const seen = new Set<string>(), out: string[] = [];
  for (const part of raw.split(/[\n,;]+/)) {
    const t = normalizeFilterText(part);
    if (t && !seen.has(t.toLowerCase())) { seen.add(t.toLowerCase()); out.push(t); }
  }
  return out.slice(0, MAX_FILTERS);
}

/* ── Folding look-alikes ─────────────────────────────────────────────────────────────────────── */

// Built from a string: soft hyphen, combining grapheme joiner, Arabic letter mark, Hangul fillers, Khmer and Mongolian
// invisibles, zero-width and bidi controls, word joiner and friends, variation selectors, BOM.
// eslint-disable-next-line no-misleading-character-class -- these are deliberately lone invisible/combining code points
const INVISIBLE = new RegExp('[\\u00ad\\u034f\\u061c\\u115f\\u1160\\u17b4\\u17b5\\u180b-\\u180f\\u200b-\\u200f\\u202a-\\u202e\\u2060-\\u206f\\u3164\\ufe00-\\ufe0f\\ufeff\\uffa0]', 'g');
/** Letters from other scripts that look like Latin ones (Unicode TR39 confusables, the common ones). */
const HOMOGLYPHS: Record<string, string> = {
  'а': 'a', 'в': 'b', 'е': 'e', 'ё': 'e', 'к': 'k', 'м': 'm', 'н': 'h', 'о': 'o', 'р': 'p', 'с': 'c', 'т': 't', 'у': 'y', 'х': 'x',
  'і': 'i', 'ї': 'i', 'ј': 'j', 'ѕ': 's', 'ԁ': 'd', 'ɡ': 'g', 'һ': 'h', 'ӏ': 'l', 'ԛ': 'q', 'ԝ': 'w',
  'α': 'a', 'β': 'b', 'ε': 'e', 'η': 'n', 'ι': 'i', 'κ': 'k', 'ν': 'v', 'ο': 'o', 'ρ': 'p', 'τ': 't', 'υ': 'u', 'χ': 'x', 'ω': 'w',
  'ı': 'i', 'ł': 'l', 'ø': 'o', 'ß': 'ss', 'æ': 'ae', 'œ': 'oe', 'ð': 'd', 'þ': 'th',
};
const LEET: Record<string, string> = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '@': 'a', '$': 's' };

/** Lower case, accents and invisible characters gone, look-alike letters folded. Digits only change inside a word
 *  that also has letters (C00L → cool, but 2024 stays 2024). */
export function fold(text: string): string {
  const base = text.normalize('NFKD').replace(/\p{M}/gu, '').replace(INVISIBLE, '').toLowerCase();
  let out = '';
  for (const ch of base) out += HOMOGLYPHS[ch] ?? ch;
  return out.replace(/[\p{L}\p{N}@$_]+/gu, w => (/\p{L}/u.test(w) && /[\d@$]/.test(w) ? w.replace(/[013457@$]/g, c => LEET[c]) : w));
}

/* ── Matching ─────────────────────────────────────────────────────────────────────────────────── */

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const BEFORE = '(?<![\\p{L}\\p{N}_])', AFTER = '(?![\\p{L}\\p{N}_])';

/** A keyword as a pattern: whole words, `*` at either end runs into a longer word, words may be joined by spaces,
 *  hyphens or underscores. Null for one that can't match anything. */
export function keywordPattern(keyword: string): RegExp | null {
  const k = fold(keyword.trim());
  const open = { start: k.startsWith('*'), end: k.endsWith('*') };
  const words = k.replace(/^\*+|\*+$/g, '').split(/[\s\-_]+/).filter(Boolean);
  if (!words.length) return null;
  const body = words.map(escape).join('[\\s\\-_]+');
  return new RegExp(`${open.start ? '' : BEFORE}${body}${open.end ? '' : AFTER}`, 'u');
}

/** Splits a hashtag's words: #ClimateChange → "climate change", #covid_19 → "covid 19". */
export function hashtagWords(tag: string): string {
  return tag.replace(/^#/, '').replace(/([\p{Ll}\p{N}])(\p{Lu})/gu, '$1 $2').replace(/(\p{Lu})(\p{Lu}\p{Ll})/gu, '$1 $2').replace(/_/g, ' ');
}

/** The hashtags in a post: its own list, else the #words in its text. */
export function postTags(p: FilterablePost): string[] {
  if (p.tags?.length) return p.tags.map(t => t.replace(/^#/, ''));
  const out = new Set<string>();
  for (const para of p.paragraphs) for (const m of para.matchAll(/(?<![\p{L}\p{N}_&/])#([\p{L}\p{N}_]+)/gu)) out.add(m[1]);
  return [...out];
}

/** Everything a filter reads in a post, as one folded string per field. */
export function postFields(p: FilterablePost): string[] {
  const fields = [...p.paragraphs, p.cw ?? '', ...(p.alt ?? []), p.linkTitle ?? '', ...postTags(p).map(hashtagWords)];
  return fields.filter(Boolean).map(fold);
}

/** The plain text an AI model sees for a post, capped. */
export function postText(p: FilterablePost, max = 1500): string {
  const parts = [p.cw ? `Content warning: ${p.cw}` : '', ...p.paragraphs, ...(p.alt ?? []).map(a => `Image: ${a}`), p.linkTitle ? `Link: ${p.linkTitle}` : ''];
  const text = parts.filter(Boolean).join('\n').trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

type Compiled = { filter: ContentFilter; patterns: RegExp[]; tag?: string; expansionPatterns: RegExp[] };

/** A hashtag as Mastodon compares them: case, accents and underscores don't matter (#Climate_Change = #climatechange). */
export const tagKey = (tag: string) => fold(tag.replace(/^#/, '')).replace(/_/g, '');

export function compileFilters(filters: ContentFilter[]): Compiled[] {
  return filters.map(f => ({
    filter: f,
    ...(f.kind === 'hashtag' ? { tag: tagKey(f.text) } : {}),
    // A hashtag filter matches the hashtag only; a topic has no fixed words of its own.
    patterns: f.kind === 'word' || f.kind === 'phrase' ? [keywordPattern(f.text)].filter((r): r is RegExp => !!r) : [],
    expansionPatterns: f.expansions.map(keywordPattern).filter((r): r is RegExp => !!r),
  }));
}

/** Why a filter caught a post: its own words (or hashtag), or a wording the AI model added. */
export type LexicalHit = { filterId: string; via: 'keyword' | 'hashtag' | 'expansion' };

/** The filters whose words appear in the post, without any AI: what's shown at once, and what the AI then checks. */
export function lexicalHits(compiled: Compiled[], p: FilterablePost): LexicalHit[] {
  const fields = postFields(p);
  const tags = new Set(postTags(p).map(tagKey));
  const hits: LexicalHit[] = [];
  for (const c of compiled) {
    if (c.tag && tags.has(c.tag)) { hits.push({ filterId: c.filter.id, via: 'hashtag' }); continue; }
    if (c.patterns.some(r => fields.some(f => r.test(f)))) { hits.push({ filterId: c.filter.id, via: 'keyword' }); continue; }
    if (c.expansionPatterns.some(r => fields.some(f => r.test(f)))) hits.push({ filterId: c.filter.id, via: 'expansion' });
  }
  return hits;
}

/* ── What a feed does with a post ────────────────────────────────────────────────────────────── */

export type Verdict = { state: 'clear' } | { state: 'pending' } | { state: 'filtered'; action: FilterAction; filter: ContentFilter };

/** The strongest filter among those that caught a post: hide wins over a warning. */
export function strongest(filters: ContentFilter[]): ContentFilter | undefined {
  return filters.find(f => f.action === 'hide') ?? filters[0];
}

/** A stable short hash (FNV-1a), for cache keys. Not for anything secret. */
export function hash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(36);
}

/** Changes whenever the filters or how they're checked change, so cached verdicts from before don't apply. */
export function filtersVersion(filters: ContentFilter[], mode: string): string {
  return hash(JSON.stringify([mode, filters.map(f => [f.id, f.text, f.kind, f.action, f.semantic, f.expansions])]));
}

/* ── Looking over a list (no AI needed) ──────────────────────────────────────────────────────── */

export type FilterCaution = { filterId: string; issue: string };

/** Filters likely to catch the wrong posts or miss the right ones, from their wording alone. */
export function lintFilters(filters: ContentFilter[]): FilterCaution[] {
  const out: FilterCaution[] = [];
  const words = new Map<string, string>();
  for (const f of filters) {
    const core = f.text.replace(/^[*#]+|\*+$/g, '');
    const lettersOnly = core.replace(/[^\p{L}\p{N}]/gu, '');
    if (/\*/.test(f.text) && lettersOnly.length <= 3) out.push({ filterId: f.id, issue: `“${f.text}” runs into any longer word that starts or ends with “${core}”, so it will catch many unrelated posts.` });
    else if (f.text.startsWith('*') && f.text.endsWith('*') && lettersOnly.length <= 5) out.push({ filterId: f.id, issue: `“${f.text}” matches “${core}” anywhere inside other words.` });
    if (f.kind === 'word' && !f.semantic && lettersOnly.length > 0 && lettersOnly.length <= 2) out.push({ filterId: f.id, issue: `“${f.text}” is very short; checking it in context avoids hiding posts that use it another way.` });
    const key = fold(core);
    const dup = words.get(key);
    if (dup) out.push({ filterId: f.id, issue: `Repeats “${dup}”.` });
    else words.set(key, f.text);
  }
  return out;
}
