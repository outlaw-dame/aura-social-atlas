import type { FedizenPost } from '../fedizen-feed';
import type { RichBlock, RichInline } from '../rich-text';

/**
 * What of a post is translated, and how it's put back, so a translation keeps the post's shape (lib/translation).
 *
 * Translated: the content warning, every paragraph (and paragraphs inside quotes, lists and centred blocks), and poll
 * option titles. Never translated: links' addresses, @mentions, #hashtags, :custom_emoji:, code, times, ruby and MFM
 * effects, preformatted blocks and formulas — these come back exactly as they were, so the translated post still
 * links, mentions and draws as the original does.
 *
 * Two forms, for two kinds of engine:
 *  - `html`: inline formatting as `<b>`, `<i>`… tags, links as `<a data-k>`, and everything kept as
 *    `<span translate="no" data-k>`, which DeepL leaves alone with tag_handling=html (developers.deepl.com, "Translating
 *    HTML") and language models are told to keep. Bold stays bold.
 *  - `plain`: for engines that take plain text (the browser's Translator API). Kept things become `{0}`, `{1}`…
 *    placeholders, put back afterwards; formatting inside a paragraph is dropped. A placeholder the engine lost is
 *    added back at the end of its paragraph, so nothing kept disappears.
 */
export type Mode = 'html' | 'plain';
export type Job = { texts: string[]; build: (out: string[]) => FedizenPost };

/** Addresses, @mentions (local or remote), #hashtags and :custom_emoji: inside text, kept as they are. */
const KEEP = /(https?:\/\/[^\s<>"]+|(?<![\w@])@[A-Za-z0-9_][A-Za-z0-9_.-]*(?:@[A-Za-z0-9.-]+\.[A-Za-z]{2,})?|(?<![\w&#])#[\p{L}\p{N}_]+|:[A-Za-z0-9_]{2,}:)/gu;

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const unesc = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');

const FORMAT = new Set(['b', 'i', 's', 'small', 'sup', 'sub']);

/** One unit of text: its translatable form and the nodes kept out of translation, by index. */
type Unit = { text: string; keep: RichInline[] };

function textUnit(v: string, keep: RichInline[], mode: Mode): string {
  let out = '', at = 0;
  for (const m of v.matchAll(KEEP)) {
    out += mode === 'html' ? esc(v.slice(at, m.index)) : v.slice(at, m.index);
    const i = keep.push({ t: 'text', v: m[0] }) - 1;
    out += mode === 'html' ? `<span translate="no" data-k="${i}">${esc(m[0])}</span>` : `{${i}}`;
    at = (m.index ?? 0) + m[0].length;
  }
  return out + (mode === 'html' ? esc(v.slice(at)) : v.slice(at));
}

function inlineUnit(c: RichInline[], keep: RichInline[], mode: Mode): string {
  return c.map(x => {
    if (x.t === 'text') return textUnit(x.v, keep, mode);
    if (x.t === 'br') return mode === 'html' ? '<br>' : '\n';
    if (mode === 'html' && FORMAT.has(x.t) && 'c' in x) return `<${x.t}>${inlineUnit(x.c, keep, mode)}</${x.t}>`;
    if (mode === 'plain' && FORMAT.has(x.t) && 'c' in x) return inlineUnit(x.c, keep, mode);
    if (mode === 'html' && x.t === 'link') {
      const i = keep.push(x) - 1;
      return `<a data-k="${i}">${inlineUnit(x.c, keep, mode)}</a>`;
    }
    const i = keep.push(x) - 1;
    return mode === 'html' ? `<span translate="no" data-k="${i}">${esc(plainOf(x))}</span>` : `{${i}}`;
  }).join('');
}

const plainOf = (x: RichInline): string => x.t === 'text' ? x.v : x.t === 'code' ? x.v : x.t === 'emoji' ? `:${x.name}:` : x.t === 'time' ? x.iso : 'c' in x ? x.c.map(plainOf).join('') : '';

/** Back from translated `html` to inline nodes: only our own tags count; anything else is text. */
export function parseHtml(s: string, keep: RichInline[]): RichInline[] {
  type Frame = { node: RichInline & { c: RichInline[] } | null; c: RichInline[]; tag: string };
  const root: Frame = { node: null, c: [], tag: '' };
  const stack: Frame[] = [root];
  const used = new Set<number>();
  const top = () => stack[stack.length - 1];
  const pushText = (v: string) => { if (!v) return; const last = top().c[top().c.length - 1]; if (last?.t === 'text') last.v += v; else top().c.push({ t: 'text', v }); };
  const TAG = /<(\/?)([a-z]+)((?:\s+[a-z-]+(?:="[^"]*")?)*)\s*\/?>/gi;
  let at = 0, skipping = 0;
  for (const m of s.matchAll(TAG)) {
    const [whole, close, name, attrs] = m;
    const tag = name.toLowerCase();
    if (!skipping) pushText(unesc(s.slice(at, m.index)));
    at = (m.index ?? 0) + whole.length;
    const k = /data-k="(\d+)"/.exec(attrs ?? '');
    if (skipping) { if (tag === 'span') skipping += close ? -1 : 1; continue; }
    if (tag === 'br' && !close) { top().c.push({ t: 'br' }); continue; }
    if (tag === 'span' && !close) {
      const i = k ? Number(k[1]) : -1;
      if (keep[i] && !used.has(i)) { used.add(i); top().c.push(keep[i]); skipping = 1; }
      continue; // a span we didn't make: its text stays
    }
    if (tag === 'span' && close) continue;
    if ((FORMAT.has(tag) || tag === 'a') && !close) {
      const i = k ? Number(k[1]) : -1;
      const src = tag === 'a' && keep[i]?.t === 'link' && !used.has(i) ? keep[i] as Extract<RichInline, { t: 'link' }> : null;
      if (tag === 'a' && !src) continue;
      if (src) used.add(i);
      const node = (src ? { t: 'link', href: src.href, c: [] } : { t: tag, c: [] }) as RichInline & { c: RichInline[] };
      stack.push({ node, c: node.c, tag });
      continue;
    }
    if ((FORMAT.has(tag) || tag === 'a') && close) {
      const idx = stack.map(f => f.tag).lastIndexOf(tag);
      if (idx > 0) while (stack.length > idx) { const f = stack.pop()!; stack[stack.length - 1].c.push(f.node!); }
    }
  }
  if (!skipping) pushText(unesc(s.slice(at)));
  while (stack.length > 1) { const f = stack.pop()!; top().c.push(f.node!); }
  // Anything kept that the engine dropped goes back at the end.
  keep.forEach((x, i) => { if (!used.has(i) && x.t !== 'link') { pushText(' '); root.c.push(x); } });
  return root.c;
}

/** Back from translated `plain` text: placeholders become the kept nodes again. */
export function parsePlain(s: string, keep: RichInline[]): RichInline[] {
  const out: RichInline[] = [];
  const used = new Set<number>();
  const pushText = (v: string) => {
    v.split('\n').forEach((line, j) => { if (j) out.push({ t: 'br' }); if (line) { const last = out[out.length - 1]; if (last?.t === 'text') last.v += line; else out.push({ t: 'text', v: line }); } });
  };
  let at = 0;
  for (const m of s.matchAll(/\{(\d+)\}/g)) {
    const i = Number(m[1]);
    if (!keep[i] || used.has(i)) continue;
    pushText(s.slice(at, m.index));
    out.push(keep[i]); used.add(i);
    at = (m.index ?? 0) + m[0].length;
  }
  pushText(s.slice(at));
  keep.forEach((x, i) => { if (!used.has(i)) { pushText(' '); out.push(x); } });
  return out;
}

const back = (s: string, keep: RichInline[], mode: Mode) => (mode === 'html' ? parseHtml(s, keep) : parsePlain(s, keep));

/** Plain text of nodes, for the paragraphs filters and previews read. */
const flat = (c: RichInline[]): string => c.map(x => x.t === 'br' ? '\n' : plainOf(x)).join('');

/** What to translate in a post, and how to make the translated post from the engine's answers (same order). */
export function translationJob(post: FedizenPost, mode: Mode): Job {
  const units: Unit[] = [];
  const add = (c: RichInline[]) => { const keep: RichInline[] = []; units.push({ text: inlineUnit(c, keep, mode), keep }); return units.length - 1; };
  const cwAt = post.cw ? add([{ t: 'text', v: post.cw }]) : -1;
  // A long-form article's title and standfirst, shown before its body opens (fedizen-feed.ts longformOf).
  const lf = post.longform ? { title: add([{ t: 'text', v: post.longform.title }]), lede: add([{ t: 'text', v: post.longform.lede }]) } : null;
  // Blocks: rich when the post has formatting, else its paragraphs.
  const blocks: RichBlock[] = post.rich?.length ? post.rich : post.paragraphs.map(p => ({ t: 'p', c: [{ t: 'text', v: p }] }));
  const plan = (b: RichBlock): unknown => b.t === 'p' ? add(b.c) : b.t === 'quote' || b.t === 'center' ? b.c.map(plan) : b.t === 'list' ? b.items.map(it => it.map(plan)) : null;
  const plans = blocks.map(plan);
  const options = post.pollState?.options.map(o => add([{ t: 'text', v: o.title }])) ?? [];
  return {
    texts: units.map(u => u.text),
    build: out => {
      const nodes = units.map((u, i) => back(out[i] ?? u.text, u.keep, mode));
      const rebuild = (b: RichBlock, p: unknown): RichBlock => b.t === 'p' ? { t: 'p', c: nodes[p as number] }
        : b.t === 'quote' || b.t === 'center' ? { ...b, c: b.c.map((x, j) => rebuild(x, (p as unknown[])[j])) }
        : b.t === 'list' ? { ...b, items: b.items.map((it, j) => it.map((x, k) => rebuild(x, ((p as unknown[][])[j])[k]))) } : b;
      const rich = blocks.map((b, i) => rebuild(b, plans[i]));
      const paragraphs = rich.flatMap(function para(b: RichBlock): string[] { return b.t === 'p' ? [flat(b.c)] : b.t === 'quote' || b.t === 'center' ? b.c.flatMap(para) : b.t === 'list' ? b.items.flat().flatMap(para) : [b.v]; });
      return {
        ...post,
        paragraphs,
        // Plain posts stay plain (their paragraphs); formatted ones keep their formatting.
        ...(post.rich?.length ? { rich } : {}),
        ...(cwAt >= 0 ? { cw: flat(nodes[cwAt]) } : {}),
        ...(lf && post.longform ? { longform: { title: flat(nodes[lf.title]) || post.longform.title, lede: flat(nodes[lf.lede]) || post.longform.lede } } : {}),
        ...(post.pollState ? { pollState: { ...post.pollState, options: post.pollState.options.map((o, i) => ({ ...o, title: flat(nodes[options[i]]) || o.title })) } } : {}),
        ...(post.poll && options.length ? { poll: options.map((u, i) => flat(nodes[u]) || post.poll![i]) } : {}),
      };
    },
  };
}

/** A post's words for detecting its language: no addresses, mentions, hashtags or emoji codes. */
export function detectionText(post: FedizenPost): string {
  return [post.cw ?? '', post.longform?.lede ?? '', ...post.paragraphs].join('\n').replace(KEEP, ' ').replace(/\s+/g, ' ').trim();
}
