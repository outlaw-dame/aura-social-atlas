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
 *
 * From Bluesky's muted words (atproto packages/api/src/moderation/mutewords.ts): words in Chinese, Japanese, Korean,
 * Thai and other scripts written without spaces match anywhere, not as whole words; "n-f-t" and "s.p.a.m" read as the
 * word; quoted posts and link descriptions are read; your own posts are never filtered; a filter can skip people you
 * follow and can expire. From Mastodon's filters (app/models/custom_filter.rb): where a filter applies, "blur" for
 * media only, poll options read, and its JSON export format for moving filters between apps.
 */

export type FilterKind = 'word' | 'phrase' | 'hashtag' | 'topic';
/** hide: gone from feeds. warn: "Filtered: …" with Show anyway. blur: the post shows, its images and video don't. */
export type FilterAction = 'hide' | 'warn' | 'blur';
/** Where a filter applies, after Mastodon's contexts: home (Following, For You, circles), public (hashtags, Local,
 *  groups) and profiles. On a profile, which someone opened on purpose, a hidden post shows as a notice instead. */
export type FilterPlace = 'home' | 'public' | 'account';
export const FILTER_PLACES: readonly FilterPlace[] = ['home', 'public', 'account'];
export type ContentFilter = {
  id: string;
  /** What the person typed: a word (`spam*`), a phrase, a #hashtag, or a topic in plain words. */
  text: string;
  kind: FilterKind;
  action: FilterAction;
  /** Checked in context by the AI model (Intelligence on): false keeps it a plain keyword. */
  semantic: boolean;
  /** Other wordings the AI model found for it (the person can edit them): matched like keywords, then checked in context. */
  expansions: string[];
  places: FilterPlace[];
  /** ISO time it stops applying; null for never. */
  expiresAt: string | null;
  /** Doesn't apply to people the person follows (Bluesky's "exclude users you follow"). */
  exceptFollowing: boolean;
};

/** What a filter needs from a post. */
export type FilterablePost = {
  id: string; statusId?: string; paragraphs: string[]; cw?: string; longform?: { lede: string }; tags?: string[]; alt?: string[]; linkTitle?: string; visibility?: string;
  linkDescription?: string; poll?: string[];
  /** The quoted post's text and image descriptions. */ quote?: string;
  /** Fedizen account id of the author, for "except people I follow". */ authorId?: string;
  /** The person's own post: never filtered. */ mine?: boolean;
};

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
/** Scripts written without spaces between words: a keyword in them matches anywhere (Bluesky does the same for ja, zh,
 *  ko, th and vi posts; Atlas decides from the keyword's own script, which works whatever language the post claims). */
export const NO_SPACES = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}\p{Script=Tibetan}]/u;
const BEFORE = '(?<![\\p{L}\\p{N}_])', AFTER = '(?![\\p{L}\\p{N}_])';

/** A keyword as a pattern: whole words, `*` at either end runs into a longer word, words may be joined by spaces,
 *  hyphens or underscores. Null for one that can't match anything. */
export function keywordPattern(keyword: string): RegExp | null {
  const k = fold(keyword.trim());
  const open = { start: k.startsWith('*'), end: k.endsWith('*') };
  const words = k.replace(/^\*+|\*+$/g, '').split(/[\s\-_]+/).filter(Boolean);
  if (!words.length) return null;
  const body = words.map(escape).join('[\\s\\-_]+');
  const anywhere = NO_SPACES.test(k);
  // An open end takes in the rest of the word, so "why it was filtered" can name the whole word ("spoilers").
  const rest = '[\\p{L}\\p{N}_]*';
  return new RegExp(`${anywhere ? '' : open.start ? rest : BEFORE}${body}${anywhere ? '' : open.end ? rest : AFTER}`, 'u');
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

/** Letters split by dots, hyphens or the like, joined back: "n-f-t" → "nft", "s.p.a.m" → "spam". A slash stays, so
 *  "and/or" never reads as "andor" (Bluesky's rule). */
const compact = (t: string) => t.replace(/(?<=[\p{L}\p{N}])[.\-_·•*'’](?=[\p{L}\p{N}])/gu, '');

/** Everything a filter reads in a post, as folded strings: text, content warning, image descriptions, link preview,
 *  poll options, the quoted post, and hashtags written out as words. */
export function postFields(p: FilterablePost): string[] {
  const fields = [...p.paragraphs, p.cw ?? '', p.longform?.lede ?? '', ...(p.alt ?? []), p.linkTitle ?? '', p.linkDescription ?? '', ...(p.poll ?? []), p.quote ?? '', ...postTags(p).map(hashtagWords)];
  const out: string[] = [];
  for (const f of fields) {
    if (!f) continue;
    const folded = fold(f);
    out.push(folded);
    const joined = compact(folded);
    if (joined !== folded) out.push(joined);
  }
  return out;
}

/** The plain text an AI model sees for a post, capped. */
export function postText(p: FilterablePost, max = 1500): string {
  const parts = [p.cw ? `Content warning: ${p.cw}` : '', p.longform ? `Summary: ${p.longform.lede}` : '', ...p.paragraphs, ...(p.alt ?? []).map(a => `Image: ${a}`), ...(p.poll ?? []).map(o => `Poll option: ${o}`),
    p.linkTitle ? `Link: ${p.linkTitle}${p.linkDescription ? ` — ${p.linkDescription}` : ''}` : '', p.quote ? `Quoting: ${p.quote}` : ''];
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

/** Why a filter caught a post: its own words (or hashtag), or a wording the AI model added, and the words that matched. */
export type LexicalHit = { filterId: string; via: 'keyword' | 'hashtag' | 'expansion'; term: string };

const firstMatch = (patterns: RegExp[], fields: string[]): string | null => {
  for (const r of patterns) for (const f of fields) { const m = r.exec(f); if (m) return m[0]; }
  return null;
};

/** The filters whose words appear in the post, without any AI: what's shown at once, and what the AI then checks. */
export function lexicalHits(compiled: Compiled[], p: FilterablePost): LexicalHit[] {
  const fields = postFields(p);
  const tags = new Set(postTags(p).map(tagKey));
  const hits: LexicalHit[] = [];
  for (const c of compiled) {
    if (c.tag && tags.has(c.tag)) { hits.push({ filterId: c.filter.id, via: 'hashtag', term: `#${c.filter.text.replace(/^#/, '')}` }); continue; }
    const own = firstMatch(c.patterns, fields);
    if (own) { hits.push({ filterId: c.filter.id, via: 'keyword', term: own }); continue; }
    const wider = firstMatch(c.expansionPatterns, fields);
    if (wider) hits.push({ filterId: c.filter.id, via: 'expansion', term: wider });
  }
  return hits;
}

/* ── What a feed does with a post ────────────────────────────────────────────────────────────── */

/** Why a post was filtered, for the notice: the words that matched, or the AI model's judgment in context. */
export type FilterReason = { by: 'words'; term: string } | { by: 'ai' } | { by: 'meaning' }
  /** From a server the person blocks in Atlas (server-blocklist.ts); the filter is that server. */
  | { by: 'server'; host: string };
export type Verdict = { state: 'clear' } | { state: 'pending' } | { state: 'filtered'; action: FilterAction; filter: ContentFilter; reason: FilterReason };

const STRENGTH: Record<FilterAction, number> = { hide: 3, warn: 2, blur: 1 };
/** The strongest filter among those that caught a post: hide, then a warning, then blurred media. */
export function strongest(filters: ContentFilter[]): ContentFilter | undefined {
  return [...filters].sort((a, b) => STRENGTH[b.action] - STRENGTH[a.action])[0];
}

/** A filter that still applies at this time and in this place. */
export function applies(f: ContentFilter, place: FilterPlace, now = Date.now()): boolean {
  return f.places.includes(place) && (!f.expiresAt || Date.parse(f.expiresAt) > now);
}

/** A stable short hash (FNV-1a), for cache keys. Not for anything secret. */
export function hash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(36);
}

/** Changes whenever the filters or how they're checked change, so cached verdicts from before don't apply. */
export function filtersVersion(filters: ContentFilter[], mode: string): string {
  return hash(JSON.stringify([mode, filters.map(f => [f.id, f.text, f.kind, f.action, f.semantic, f.expansions, f.places, f.expiresAt, f.exceptFollowing])]));
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
    // Short is fine in scripts without spaces: 政治 (politics) is a whole word in two characters.
    if (f.kind === 'word' && !f.semantic && lettersOnly.length > 0 && lettersOnly.length <= 2 && !NO_SPACES.test(core)) out.push({ filterId: f.id, issue: `“${f.text}” is very short; checking it in context avoids hiding posts that use it another way.` });
    const key = fold(core);
    const dup = words.get(key);
    if (dup) out.push({ filterId: f.id, issue: `Repeats “${dup}”.` });
    else words.set(key, f.text);
  }
  return out;
}

/* ── Moving filters between apps (Mastodon's JSON export, 5.0) ───────────────────────────────── */

/** Mastodon's export: app/models/export.rb#to_custom_filters_json. */
export type MastodonFilterExport = { custom_filters: { title: string; expires_at: string | null; context: string[]; action: string; keywords_attributes: { keyword: string; whole_word: boolean }[]; statuses?: string[] }[] };
export type ImportedFilter = { text: string; action: FilterAction; places: FilterPlace[]; expiresAt: string | null };

const MASTODON_CONTEXT: Record<FilterPlace, string> = { home: 'home', public: 'public', account: 'account' };

/** Atlas filters in Mastodon's format. A filter's AI-found wordings go along as more keywords, so they keep working
 *  in an app without AI. Mastodon has no topic filters: a topic travels as its wordings (or as its words, if none). */
export function toMastodonExport(filters: ContentFilter[]): MastodonFilterExport {
  return {
    custom_filters: filters.map(f => {
      const kw = (t: string) => ({ keyword: t.replace(/^\*+|\*+$/g, ''), whole_word: !t.includes('*') });
      const own = f.kind === 'topic' && f.expansions.length ? [] : [kw(f.text)];
      return {
        title: f.text, expires_at: f.expiresAt, context: f.places.map(p => MASTODON_CONTEXT[p]),
        action: f.action, keywords_attributes: [...own, ...f.expansions.map(kw)].filter(k => k.keyword), statuses: [],
      };
    }),
  };
}

/** Filters from Mastodon's JSON export: each keyword becomes an Atlas filter with its filter's action, places and
 *  expiry. A keyword without "whole word" matched inside other words in Mastodon, so it becomes *keyword*. Posts
 *  filtered one by one (statuses) don't carry over. Null when the file isn't a Mastodon filter export. */
export function fromMastodonExport(json: unknown): ImportedFilter[] | null {
  const list = (json as MastodonFilterExport | null)?.custom_filters;
  if (!Array.isArray(list)) return null;
  const out: ImportedFilter[] = [], seen = new Set<string>();
  for (const f of list.slice(0, MAX_FILTERS)) {
    const action: FilterAction = f?.action === 'hide' || f?.action === 'blur' ? f.action : 'warn';
    const ctx = Array.isArray(f?.context) ? f.context : [];
    const places = FILTER_PLACES.filter(p => ctx.includes(MASTODON_CONTEXT[p]));
    const expiresAt = typeof f?.expires_at === 'string' && !Number.isNaN(Date.parse(f.expires_at)) ? new Date(f.expires_at).toISOString() : null;
    for (const k of Array.isArray(f?.keywords_attributes) ? f.keywords_attributes : []) {
      const word = typeof k?.keyword === 'string' ? normalizeFilterText(k.keyword.replace(/\*/g, '')) : null;
      if (!word) continue;
      const text = k.whole_word === false ? `*${word}*` : word;
      if (seen.has(text.toLowerCase())) continue;
      seen.add(text.toLowerCase());
      out.push({ text, action, places: places.length ? places : [...FILTER_PLACES], expiresAt });
    }
  }
  return out.slice(0, MAX_FILTERS);
}
