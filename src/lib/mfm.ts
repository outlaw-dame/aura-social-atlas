import { parse, type MfmNode } from 'mfm-js';
import { hasFormatting, safeHref, unixtimeIso, type MfmArgs, type RichBlock, type RichInline } from './rich-text';

/**
 * Misskey's own markup (MFM) → Atlas's post model (rich-text.ts), using Misskey's parser (mfm-js, MIT). Used when a
 * Misskey-family post is read from its own server and carries its source (`source.mediaType` "text/x.misskeymarkdown",
 * or the older `_misskey_content`): Misskey's HTML drops what MFM functions do (it turns them into <i>), so the
 * source is the only complete version. Mentions, hashtags, addresses and `:emoji:` stay as text: Atlas makes them
 * live when it draws the text, as for every other post.
 */

const MAX_SOURCE = 20_000;
const MAX_NODES = 4000;

export const MFM_MEDIA_TYPE = 'text/x.misskeymarkdown';

/** The MFM source of an ActivityPub object, if it has one. */
export function mfmSourceOf(o: Record<string, unknown>): string | undefined {
  const src = o.source;
  if (src && typeof src === 'object') {
    const s = src as Record<string, unknown>;
    if (s.mediaType === MFM_MEDIA_TYPE && typeof s.content === 'string') return s.content;
  }
  return typeof o._misskey_content === 'string' ? o._misskey_content : undefined;
}

export function mfmToRich(source: string): RichBlock[] | undefined {
  if (!source.trim()) return undefined;
  let nodes: MfmNode[];
  try { nodes = parse(source.slice(0, MAX_SOURCE), { nestLimit: 20 }); } catch { return undefined; }
  let budget = MAX_NODES;
  const b = toBlocks(nodes, () => --budget > 0);
  return b.length && hasFormatting(b) ? b : undefined;
}

function toBlocks(nodes: MfmNode[], more: () => boolean): RichBlock[] {
  const out: RichBlock[] = [];
  let run: RichInline[] = [];
  let breaks = 0;
  const flush = () => {
    while (run.length && run[run.length - 1].t === 'br') run.pop();
    if (run.length) out.push({ t: 'p', c: run });
    run = []; breaks = 0;
  };
  const push = (x: RichInline) => {
    if (breaks >= 2) flush();
    else if (breaks === 1 && run.length) run.push({ t: 'br' });
    breaks = 0;
    run.push(x);
  };
  for (const n of nodes) {
    if (!more()) break;
    switch (n.type) {
      case 'quote': flush(); { const c = toBlocks(n.children, more); if (c.length) out.push({ t: 'quote', c }); } break;
      case 'center': flush(); { const c = toBlocks(n.children, more); if (c.length) out.push({ t: 'center', c }); } break;
      case 'blockCode': flush(); out.push({ t: 'pre', v: n.props.code, ...(n.props.lang && /^[\w+#-]{1,24}$/.test(n.props.lang) ? { lang: n.props.lang } : {}) }); break;
      case 'mathBlock': flush(); out.push({ t: 'math', v: n.props.formula }); break;
      // Misskey draws a search box; the query, as text, keeps what it says.
      case 'search': flush(); out.push({ t: 'p', c: [{ t: 'text', v: n.props.content }] }); break;
      case 'text': {
        // Newlines are line breaks; a blank line starts a paragraph.
        const parts = n.props.text.split('\n');
        parts.forEach((part, i) => {
          if (i > 0) breaks++;
          if (part) push({ t: 'text', v: part });
        });
        break;
      }
      default: for (const x of inline([n], more)) push(x);
    }
  }
  flush();
  return out;
}

function inline(nodes: MfmNode[], more: () => boolean): RichInline[] {
  const out: RichInline[] = [];
  for (const n of nodes) {
    if (!more()) break;
    const kids = () => 'children' in n && n.children ? inline(n.children as MfmNode[], more) : [];
    switch (n.type) {
      case 'text': n.props.text.split('\n').forEach((part, i) => { if (i) out.push({ t: 'br' }); if (part) out.push({ t: 'text', v: part }); }); break;
      case 'bold': out.push({ t: 'b', c: kids() }); break;
      case 'italic': out.push({ t: 'i', c: kids() }); break;
      case 'strike': out.push({ t: 's', c: kids() }); break;
      case 'small': out.push({ t: 'small', c: kids() }); break;
      case 'inlineCode': out.push({ t: 'code', v: n.props.code }); break;
      case 'mathInline': out.push({ t: 'code', v: n.props.formula }); break;
      case 'mention': out.push({ t: 'text', v: n.props.acct }); break;
      case 'hashtag': out.push({ t: 'text', v: `#${n.props.hashtag}` }); break;
      case 'url': out.push({ t: 'text', v: n.props.url }); break;
      case 'emojiCode': out.push({ t: 'text', v: `:${n.props.name}:` }); break;
      case 'unicodeEmoji': out.push({ t: 'text', v: n.props.emoji }); break;
      case 'plain': out.push(...kids()); break;
      case 'link': {
        const href = safeHref(n.props.url);
        out.push(...(href ? [{ t: 'link' as const, href, c: kids() }] : kids()));
        break;
      }
      case 'fn': {
        const { name, args } = n.props;
        if (name === 'ruby') {
          // `$[ruby 漢字 かんじ]`, or with formatting: the last word is the reading (Misskey's rule).
          const c = n.children;
          const last = c[c.length - 1];
          if (c.length === 1 && last?.type === 'text') {
            const [base, ...rt] = last.props.text.split(' ');
            out.push({ t: 'ruby', c: [{ t: 'text', v: base }], rt: rt.join(' ').trim() });
          } else if (last?.type === 'text') {
            out.push({ t: 'ruby', c: inline(c.slice(0, -1), more), rt: last.props.text.trim() });
          } else out.push(...kids());
          break;
        }
        if (name === 'unixtime') {
          const first = n.children[0];
          const iso = first?.type === 'text' ? unixtimeIso(first.props.text.trim()) : undefined;
          out.push(...(iso ? [{ t: 'time' as const, iso }] : kids()));
          break;
        }
        const a: MfmArgs = {};
        for (const [k, v] of Object.entries(args ?? {})) if (/^[a-z][a-z0-9]{0,23}$/i.test(k)) a[k] = v === true ? true : String(v).slice(0, 64);
        out.push({ t: 'fn', name: /^[a-z][a-z0-9]{0,23}$/.test(name) ? name : 'unknown', args: a, c: kids() });
        break;
      }
      // Block nodes inside inline content (rare): their text.
      case 'quote': case 'center': out.push(...kids()); break;
      case 'blockCode': out.push({ t: 'code', v: n.props.code }); break;
      case 'mathBlock': out.push({ t: 'code', v: n.props.formula }); break;
      case 'search': out.push({ t: 'text', v: n.props.content }); break;
    }
  }
  return out;
}
