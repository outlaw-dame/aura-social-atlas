/**
 * Post formatting, read from remote HTML or Misskey's MFM into a closed model that React draws. Remote markup is
 * never injected: only the elements and attributes below are read, everything else contributes its text alone, and
 * links keep only http(s) addresses. Plain-text paragraphs (htmlToParagraphs) stay what filters, search and previews
 * read; this model is only for showing a post.
 *
 * MFM functions arrive two ways:
 *  - as HTML from servers that encode them per FEP-c16b — `<span class="mfm-jelly" data-mfm-speed="2s">` (Akkoma's
 *    and Pleroma's MFM parser, which Bonfire runs on incoming Misskey posts), or the older `_mfm_jelly_` class form;
 *  - as MFM source (`source.mediaType` text/x.misskeymarkdown) when Atlas reads a Misskey-family post from its own
 *    server: see mfm.ts.
 * Which functions are drawn, and with which arguments, is decided when drawing (RichText.tsx), from MFM_FUNCTIONS.
 */

export type MfmArgs = Record<string, string | true>;

export type RichInline =
  | { t: 'text'; v: string }
  | { t: 'br' }
  | { t: 'b' | 'i' | 's' | 'small' | 'sup' | 'sub'; c: RichInline[] }
  | { t: 'code'; v: string }
  /** A link whose words aren't its address (Markdown or MFM `[label](url)`); bare addresses stay text, linked when shown. */
  | { t: 'link'; href: string; c: RichInline[] }
  | { t: 'ruby'; c: RichInline[]; rt: string }
  | { t: 'time'; iso: string }
  /** A custom emoji by shortcode, drawn from the post's own emoji list when it has one. */
  | { t: 'emoji'; name: string }
  | { t: 'fn'; name: string; args: MfmArgs; c: RichInline[] };

export type RichBlock =
  | { t: 'p'; c: RichInline[] }
  | { t: 'pre'; v: string; lang?: string }
  | { t: 'quote'; c: RichBlock[] }
  | { t: 'center'; c: RichBlock[] }
  | { t: 'list'; ordered: boolean; items: RichBlock[][] }
  /** KaTeX source; shown as code, as Misskey's own HTML does. */
  | { t: 'math'; v: string };

/**
 * MFM functions Atlas draws: Misskey's (packages/frontend-shared/js/mfm-renderer.ts) plus those Misskey forks added
 * (fade: Firefish, Sharkey, CherryPick; crop and followmouse: Sharkey, Cutiekey). Any other function shows its
 * content without an effect.
 */
export const MFM_FUNCTIONS = new Set([
  'tada', 'jelly', 'twitch', 'shake', 'spin', 'jump', 'bounce', 'flip', 'x2', 'x3', 'x4', 'font', 'blur', 'rainbow',
  'sparkle', 'rotate', 'position', 'scale', 'fg', 'bg', 'border', 'ruby', 'unixtime', 'clickable', 'fade', 'crop',
  'followmouse',
]);

const FN_NAME = /^[a-z][a-z0-9]{0,23}$/;
const ARG_NAME = /^[a-z][a-z0-9]{0,23}$/i;
/** How much a post may hold, so one hostile post can't make every reader's device do unbounded work. */
const MAX_NODES = 4000;
const MAX_DEPTH = 32;
const MAX_HTML = 200_000;

/* ── HTML → tree ─────────────────────────────────────────────────────────────────────────────────────── */

type El = { tag: string; attrs: Record<string, string>; kids: Node[] };
type Node = El | string;

const NAMED: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', shy: '­', zwj: '‍', zwnj: '‌' };

/** HTML character references: numeric ones in full, named ones for what posts use; others stay as written. */
export function decodeEntities(s: string): string {
  return s.replace(/&(#\d{1,7}|#x[0-9a-f]{1,6}|[a-z]{2,8});/gi, (all, ref: string) => {
    if (ref[0] !== '#') return NAMED[ref.toLowerCase()] ?? all;
    const n = ref[1] === 'x' || ref[1] === 'X' ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10);
    // Out of range, surrogates and NUL become the replacement character, as browsers do.
    if (!Number.isFinite(n) || n === 0 || n > 0x10ffff || (n >= 0xd800 && n <= 0xdfff)) return '�';
    return String.fromCodePoint(n);
  });
}

const VOID = new Set(['br', 'img', 'hr', 'wbr', 'input', 'meta', 'link', 'source', 'area', 'base', 'col', 'embed', 'param', 'track']);
const SKIP_CONTENT = new Set(['script', 'style', 'template', 'noscript', 'iframe', 'object', 'svg', 'math', 'textarea', 'select', 'head', 'title']);
const TOKEN = /<!--[\s\S]*?(?:-->|$)|<\/?([a-zA-Z][a-zA-Z0-9-]*)((?:\s+[^\s"'>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'>]+))?)*)\s*\/?>|[^<]+|</g;
const ATTR = /([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;

function parseHtml(html: string): Node[] {
  const root: El = { tag: '#root', attrs: {}, kids: [] };
  const stack: El[] = [root];
  let count = 0;
  const src = html.length > MAX_HTML ? html.slice(0, MAX_HTML) : html;
  TOKEN.lastIndex = 0;
  for (let m = TOKEN.exec(src); m; m = TOKEN.exec(src)) {
    if (++count > MAX_NODES) break;
    const tok = m[0];
    const top = stack[stack.length - 1];
    if (tok.startsWith('<!--')) continue;
    if (!m[1]) { top.kids.push(decodeEntities(tok)); continue; }
    const tag = m[1].toLowerCase();
    if (tok[1] === '/') {
      const at = stack.map(e => e.tag).lastIndexOf(tag);
      if (at > 0) stack.length = at;
      continue;
    }
    if (SKIP_CONTENT.has(tag)) {
      // Everything up to its end tag is dropped, nested or not.
      const end = src.toLowerCase().indexOf(`</${tag}`, TOKEN.lastIndex);
      TOKEN.lastIndex = end < 0 ? src.length : end;
      continue;
    }
    const attrs: Record<string, string> = {};
    if (m[2]) for (const a of m[2].matchAll(ATTR)) {
      const name = a[1].toLowerCase();
      if (name === 'class' || name === 'style' || name === 'href' || name === 'alt' || name === 'datetime' || name.startsWith('data-')) {
        attrs[name] = decodeEntities(a[2] ?? a[3] ?? a[4] ?? '');
      }
    }
    const el: El = { tag, attrs, kids: [] };
    top.kids.push(el);
    if (!VOID.has(tag) && !tok.endsWith('/>') && stack.length < MAX_DEPTH) stack.push(el);
  }
  return root.kids;
}

/** `$[unixtime 1700000000]`: seconds since 1970, within years 1970–9999. */
export function unixtimeIso(s: string): string | undefined {
  if (!/^\d{1,12}$/.test(s)) return undefined;
  const ms = Number(s) * 1000;
  return ms <= 253402300799000 ? new Date(ms).toISOString() : undefined;
}

const textOf = (n: Node): string => typeof n === 'string' ? n : n.tag === 'br' ? '\n' : n.kids.map(textOf).join('');
const classes = (e: El) => (e.attrs.class ?? '').split(/\s+/).filter(Boolean);

/** Only web addresses: no javascript:, data: or relative links. */
export function safeHref(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  try {
    const u = new URL(raw.trim());
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : undefined;
  } catch { return undefined; }
}

/** An MFM function encoded in HTML: `mfm-name` (FEP-c16b) or `_mfm_name_` (Akkoma's earlier form), its arguments
 *  as `data-mfm-*` (or the earlier bare `data-*`). */
function mfmFnOf(e: El): { name: string; args: MfmArgs } | null {
  if (e.tag !== 'span') return null;
  let name: string | undefined;
  for (const c of classes(e)) {
    const m = /^mfm-([a-z0-9]+)$/.exec(c) ?? /^_mfm_([a-z0-9]+)_$/.exec(c);
    if (m && FN_NAME.test(m[1])) { name = m[1]; break; }
  }
  if (!name) return null;
  const args: MfmArgs = {};
  for (const [k, v] of Object.entries(e.attrs)) {
    if (!k.startsWith('data-')) continue;
    const arg = k.startsWith('data-mfm-') ? k.slice(9) : k.slice(5);
    if (ARG_NAME.test(arg)) args[arg] = v === '' ? true : v.slice(0, 64);
  }
  return { name, args };
}

const BLOCK_TAGS = new Set(['p', 'div', 'blockquote', 'pre', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'table', 'tr', 'section', 'article', 'header', 'footer', 'figure', 'figcaption', 'center', 'details', 'summary', 'dl', 'dt', 'dd']);

function inline(nodes: Node[], out: RichInline[]): void {
  for (const n of nodes) {
    if (typeof n === 'string') { const v = n.replace(/\s+/g, ' '); if (v) out.push({ t: 'text', v }); continue; }
    const kids = (): RichInline[] => { const c: RichInline[] = []; inline(n.kids, c); return c; };
    switch (n.tag) {
      case 'br': out.push({ t: 'br' }); break;
      case 'b': case 'strong': out.push({ t: 'b', c: kids() }); break;
      case 'i': case 'em': case 'cite': case 'var': case 'dfn': out.push({ t: 'i', c: kids() }); break;
      case 's': case 'del': case 'strike': out.push({ t: 's', c: kids() }); break;
      case 'small': out.push({ t: 'small', c: kids() }); break;
      case 'sup': out.push({ t: 'sup', c: kids() }); break;
      case 'sub': out.push({ t: 'sub', c: kids() }); break;
      case 'code': case 'kbd': case 'samp': case 'tt': out.push({ t: 'code', v: textOf(n) }); break;
      case 'ruby': {
        const base: Node[] = [], rt: string[] = [];
        for (const k of n.kids) {
          if (typeof k !== 'string' && k.tag === 'rt') rt.push(textOf(k));
          else if (typeof k === 'string' || k.tag !== 'rp') base.push(k);
        }
        const c: RichInline[] = []; inline(base, c);
        out.push({ t: 'ruby', c, rt: rt.join(' ').trim() });
        break;
      }
      case 'time': {
        const iso = n.attrs.datetime && !Number.isNaN(Date.parse(n.attrs.datetime)) ? new Date(n.attrs.datetime).toISOString() : undefined;
        if (iso) out.push({ t: 'time', iso }); else out.push(...kids());
        break;
      }
      case 'img': {
        const alt = (n.attrs.alt ?? '').trim();
        const code = /^:([\w+-]{1,64}):$/.exec(alt);
        if (code) out.push({ t: 'emoji', name: code[1] });
        else if (alt) out.push({ t: 'text', v: alt });
        break;
      }
      case 'a': {
        const href = safeHref(n.attrs.href);
        const words = textOf(n).replace(/\s+/g, ' ').trim();
        const cls = classes(n);
        // Mentions, hashtags and bare addresses are made live from their text when shown, as before; only a link
        // whose words differ from where it goes is kept as a link here.
        const plain = !href || !words || /^[@#]/.test(words) || /^(https?:\/\/|www\.)/i.test(words) || href.replace(/^https?:\/\/(www\.)?/i, '').startsWith(words.replace(/…$/, ''))
          || cls.some(c => c === 'mention' || c === 'hashtag' || c === 'u-url');
        if (plain) out.push(...kids()); else out.push({ t: 'link', href: href!, c: kids() });
        break;
      }
      case 'span': {
        const fn = mfmFnOf(n);
        if (fn?.name === 'ruby' || fn?.name === 'unixtime') {
          const words = textOf(n).trim();
          if (fn.name === 'unixtime') {
            const iso = unixtimeIso(words);
            if (iso) { out.push({ t: 'time', iso }); break; }
          } else {
            const gap = words.lastIndexOf(' ');
            if (gap > 0) { out.push({ t: 'ruby', c: [{ t: 'text', v: words.slice(0, gap) }], rt: words.slice(gap + 1) }); break; }
          }
          out.push(...kids());
          break;
        }
        if (fn) out.push({ t: 'fn', name: fn.name, args: fn.args, c: kids() });
        else out.push(...kids());
        break;
      }
      default: out.push(...kids());
    }
  }
}

function trimInline(c: RichInline[]): RichInline[] {
  let a = 0, b = c.length;
  const blank = (x: RichInline) => x.t === 'br' || (x.t === 'text' && !x.v.trim());
  while (a < b && blank(c[a])) a++;
  while (b > a && blank(c[b - 1])) b--;
  const out = c.slice(a, b);
  if (out[0]?.t === 'text') out[0] = { t: 'text', v: out[0].v.replace(/^\s+/, '') };
  const last = out[out.length - 1];
  if (last?.t === 'text') out[out.length - 1] = { t: 'text', v: last.v.replace(/\s+$/, '') };
  return out;
}

function blocks(nodes: Node[], out: RichBlock[] = []): RichBlock[] {
  let run: Node[] = [];
  const flush = () => {
    if (!run.length) return;
    const c: RichInline[] = []; inline(run, c); run = [];
    const t = trimInline(c);
    if (t.length) out.push({ t: 'p', c: t });
  };
  for (const n of nodes) {
    if (typeof n === 'string' || !BLOCK_TAGS.has(n.tag)) { run.push(n); continue; }
    flush();
    switch (n.tag) {
      case 'p': case 'dt': case 'dd': case 'summary': case 'figcaption': {
        const c: RichInline[] = []; inline(n.kids, c);
        const t = trimInline(c);
        if (t.length) out.push({ t: 'p', c: t });
        break;
      }
      case 'h1': case 'h2': case 'h3': case 'h4': case 'h5': case 'h6': {
        const c: RichInline[] = []; inline(n.kids, c);
        const t = trimInline(c);
        if (t.length) out.push({ t: 'p', c: [{ t: 'b', c: t }] });
        break;
      }
      case 'pre': {
        const code = n.kids.find((k): k is El => typeof k !== 'string' && k.tag === 'code');
        const lang = code && classes(code).map(c => /^language-([\w+#-]{1,24})$/.exec(c)?.[1]).find(Boolean);
        const v = textOf(n).replace(/^\n/, '').replace(/\s+$/, '');
        if (v) out.push({ t: 'pre', v, ...(lang ? { lang } : {}) });
        break;
      }
      case 'blockquote': { const c = blocks(n.kids); if (c.length) out.push({ t: 'quote', c }); break; }
      case 'ul': case 'ol': {
        const items = n.kids.filter((k): k is El => typeof k !== 'string' && k.tag === 'li').map(li => blocks(li.kids)).filter(b => b.length);
        if (items.length) out.push({ t: 'list', ordered: n.tag === 'ol', items });
        break;
      }
      case 'hr': break;
      case 'center': { const c = blocks(n.kids); if (c.length) out.push({ t: 'center', c }); break; }
      default: {
        const centred = /text-align\s*:\s*center/i.test(n.attrs.style ?? '') || classes(n).includes('mfm-center');
        if (centred) { const c = blocks(n.kids); if (c.length) out.push({ t: 'center', c }); }
        else blocks(n.kids, out);
      }
    }
  }
  flush();
  return out;
}

/** Whether a post's formatting needs this model: anything besides plain paragraphs and line breaks. (A custom emoji
 *  written as `:code:` text is drawn from plain paragraphs too; one that arrives as an <img> needs the model.) */
export function hasFormatting(b: RichBlock[]): boolean {
  const inl = (c: RichInline[]): boolean => c.some(x => x.t !== 'text' && x.t !== 'br');
  return b.some(x => x.t !== 'p' || inl(x.c));
}

/** Remote HTML → the model, or undefined when the post is plain text (its paragraphs show it as well). */
export function htmlToRich(html: string | null | undefined): RichBlock[] | undefined {
  if (!html || !/<(?!(?:p|br|span)\b)[a-z]|class="[^"]*(?:mfm|_mfm_)/i.test(html)) return undefined;
  const b = blocks(parseHtml(html));
  return b.length && hasFormatting(b) ? b : undefined;
}

/** Plain text of the model, for checks and fallbacks. */
export function richText(b: RichBlock[]): string {
  const inl = (c: RichInline[]): string => c.map(x => x.t === 'text' ? x.v : x.t === 'br' ? '\n' : x.t === 'code' ? x.v
    : x.t === 'emoji' ? `:${x.name}:` : x.t === 'time' ? x.iso : 'c' in x ? inl(x.c) + (x.t === 'ruby' ? `(${x.rt})` : '') : '').join('');
  return b.map(x => x.t === 'p' ? inl(x.c) : x.t === 'pre' || x.t === 'math' ? x.v : x.t === 'list' ? x.items.map(richText).join('\n') : richText(x.c)).join('\n\n');
}

/* ── Custom emoji ───────────────────────────────────────────────────────────────────────────────────── */

export type CustomEmoji = { url: string; staticUrl?: string };
export type EmojiMap = Record<string, CustomEmoji>;

/** A post's custom emoji (Mastodon's `emojis`, or ActivityPub `Emoji` tags), https images only, at most 100. */
export function emojiMap(list: unknown): EmojiMap | undefined {
  if (!Array.isArray(list)) return undefined;
  const out: EmojiMap = {};
  let n = 0;
  for (const e of list) {
    if (n >= 100 || !e || typeof e !== 'object') continue;
    const o = e as Record<string, unknown>;
    // Mastodon: { shortcode, url, static_url }; ActivityPub: { type: "Emoji", name: ":code:", icon: { url } }.
    const code = typeof o.shortcode === 'string' ? o.shortcode : typeof o.name === 'string' && o.type === 'Emoji' ? o.name.replace(/^:|:$/g, '') : undefined;
    const icon = o.icon && typeof o.icon === 'object' ? (o.icon as Record<string, unknown>).url : undefined;
    const url = httpsOnly(typeof o.url === 'string' ? o.url : typeof icon === 'string' ? icon : undefined);
    if (!code || !/^[\w+-]{1,64}$/.test(code) || !url) continue;
    const staticUrl = httpsOnly(typeof o.static_url === 'string' ? o.static_url : undefined);
    out[code] = staticUrl && staticUrl !== url ? { url, staticUrl } : { url };
    n++;
  }
  return n ? out : undefined;
}

function httpsOnly(u: string | undefined): string | undefined {
  const h = safeHref(u);
  return h?.startsWith('https://') ? h : undefined;
}
