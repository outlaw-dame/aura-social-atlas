import { Fragment, type CSSProperties, type ReactNode } from 'react';
import type { FediMention } from '@/lib/fedizen-feed';
import { MFM_FUNCTIONS, type EmojiMap, type MfmArgs, type RichBlock, type RichInline } from '@/lib/rich-text';
import { linkifyPost } from './PostPeople';

/**
 * A post's text as its author formatted it: bold, italics, code, quotes, lists, ruby, custom emoji and Misskey's MFM
 * functions, from the closed model in rich-text.ts — never remote HTML. Posts without formatting show their plain
 * paragraphs, as before. Text runs keep Atlas's links, mentions and hashtags (linkifyPost).
 *
 * MFM effects follow Misskey's renderer for what each function does and which arguments it accepts, with Atlas's own
 * CSS (styles.css, .atlas-mfm-*): animations run only when the system allows motion (Reduce Motion stops them, as
 * Misskey's "animated MFM" setting does), and every effect stays inside its paragraph, so no post can draw over the
 * rest of the page. Interactive functions (clickable, followmouse) show their content still.
 */

type Body = { paragraphs: string[]; rich?: RichBlock[]; emojis?: EmojiMap; mentions?: FediMention[] };

export function PostBody({ post, onTag, limit, pClassName, pStyle }: {
  post: Body; onTag: (tag: string) => void;
  /** Show at most this many paragraphs or blocks. */
  limit?: number;
  /** Class and style for each top-level paragraph or block, as the surrounding card spaces them. */
  pClassName?: string; pStyle?: CSSProperties;
}) {
  const ctx: Ctx = { emojis: post.emojis, mentions: post.mentions, onTag };
  if (!post.rich?.length) {
    const list = limit ? post.paragraphs.slice(0, limit) : post.paragraphs;
    return <>{list.map((t, i) => <p key={i} className={pClassName} style={pStyle}>{text(t, ctx)}</p>)}</>;
  }
  const list = limit ? post.rich.slice(0, limit) : post.rich;
  return <>{list.map((b, i) => <BlockView key={i} b={b} ctx={ctx} className={pClassName} style={pStyle} />)}</>;
}

type Ctx = { emojis?: EmojiMap; mentions?: FediMention[]; onTag: (tag: string) => void };

const cx = (...c: (string | undefined | false)[]) => c.filter(Boolean).join(' ') || undefined;

function BlockView({ b, ctx, className, style }: { b: RichBlock; ctx: Ctx; className?: string; style?: CSSProperties }): ReactNode {
  switch (b.t) {
    case 'p': return <p className={cx(className, hasFn(b.c) && 'atlas-mfm-fx')} style={style}>{inlines(b.c, ctx, 1)}</p>;
    case 'pre': return (
      // Scrollable sideways, so focusable to scroll by keyboard.
      <pre className={cx(className, 'atlas-rt-pre')} style={style} tabIndex={0}><code {...(b.lang ? { 'data-lang': b.lang } : {})}>{b.v}</code></pre>
    );
    case 'math': return <pre className={cx(className, 'atlas-rt-pre')} style={style} tabIndex={0} aria-label="Formula"><code>{b.v}</code></pre>;
    case 'quote': return <blockquote className={cx(className, 'atlas-rt-quote')} style={style}>{b.c.map((x, i) => <BlockView key={i} b={x} ctx={ctx} />)}</blockquote>;
    case 'center': return <div className={cx(className, 'atlas-rt-center')} style={style}>{b.c.map((x, i) => <BlockView key={i} b={x} ctx={ctx} />)}</div>;
    case 'list': {
      const Tag = b.ordered ? 'ol' : 'ul';
      return <Tag className={cx(className, 'atlas-rt-list')} style={style}>{b.items.map((item, i) => <li key={i}>{item.map((x, j) => <BlockView key={j} b={x} ctx={ctx} />)}</li>)}</Tag>;
    }
  }
}

const hasFn = (c: RichInline[]): boolean => c.some(x => x.t === 'fn' || ('c' in x && hasFn(x.c)));

/** `scale` is how much bigger the text already is (x2 inside x3), to stop nested size functions as Misskey does. */
function inlines(c: RichInline[], ctx: Ctx, scale: number): ReactNode[] {
  return c.map((x, i) => <Fragment key={i}>{inlineView(x, ctx, scale)}</Fragment>);
}

function inlineView(x: RichInline, ctx: Ctx, scale: number): ReactNode {
  switch (x.t) {
    case 'text': return text(x.v, ctx);
    case 'br': return <br />;
    case 'b': return <strong>{inlines(x.c, ctx, scale)}</strong>;
    case 'i': return <em>{inlines(x.c, ctx, scale)}</em>;
    case 's': return <del>{inlines(x.c, ctx, scale)}</del>;
    case 'small': return <small className="atlas-rt-small">{inlines(x.c, ctx, scale)}</small>;
    case 'sup': return <sup>{inlines(x.c, ctx, scale)}</sup>;
    case 'sub': return <sub>{inlines(x.c, ctx, scale)}</sub>;
    case 'code': return <code className="atlas-rt-code">{x.v}</code>;
    case 'link': return (
      <a href={x.href} target="_blank" rel="noopener noreferrer nofollow ugc" className="atlas-post-link" title={x.href}
        onClick={e => e.stopPropagation()}>{inlines(x.c, ctx, scale)}</a>
    );
    case 'ruby': return <ruby>{inlines(x.c, ctx, scale)}<rp>(</rp><rt>{x.rt}</rt><rp>)</rp></ruby>;
    case 'time': return <TimeView iso={x.iso} />;
    case 'emoji': return <Emoji name={x.name} emojis={ctx.emojis} />;
    case 'fn': return fnView(x.name, x.args, x.c, ctx, scale);
  }
}

/* ── Text runs: custom emoji, then links, mentions and hashtags ─────────────────────────────────────── */

const SHORTCODE = /:([\w+-]{1,64}):/g;

function text(v: string, ctx: Ctx): ReactNode[] {
  const { emojis, mentions, onTag } = ctx;
  if (!emojis || !v.includes(':')) return linkifyPost(v, mentions, onTag);
  const out: ReactNode[] = [];
  let at = 0;
  for (const m of v.matchAll(SHORTCODE)) {
    if (!emojis[m[1]]) continue;
    const start = m.index!;
    if (start > at) out.push(<Fragment key={`t${at}`}>{linkifyPost(v.slice(at, start), mentions, onTag)}</Fragment>);
    out.push(<Emoji key={`e${start}`} name={m[1]} emojis={emojis} />);
    at = start + m[0].length;
  }
  if (at < v.length) out.push(<Fragment key={`t${at}`}>{linkifyPost(v.slice(at), mentions, onTag)}</Fragment>);
  return out;
}

function Emoji({ name, emojis }: { name: string; emojis?: EmojiMap }) {
  const e = emojis?.[name];
  if (!e) return <>:{name}:</>;
  const img = <img className="atlas-emoji" src={e.url} alt={`:${name}:`} title={`:${name}:`} draggable={false} loading="lazy" decoding="async" referrerPolicy="no-referrer" />;
  // Animated emoji stand still under Reduce Motion when the server has a still image.
  return e.staticUrl ? <picture><source media="(prefers-reduced-motion: reduce)" srcSet={e.staticUrl} />{img}</picture> : img;
}

function TimeView({ iso }: { iso: string }) {
  const d = new Date(iso);
  const shown = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(d);
  return <time className="atlas-rt-time" dateTime={iso} suppressHydrationWarning>{shown}</time>;
}

/* ── MFM functions ──────────────────────────────────────────────────────────────────────────────────── */

/** "1.5s", as Misskey accepts (`/^-?[0-9.]+s$/`), and at most a minute. */
const seconds = (v: string | true | undefined) => typeof v === 'string' && /^-?\d*\.?\d+s$/.test(v) && Math.abs(parseFloat(v)) <= 60 ? v : undefined;
/** Hex without "#", as Misskey accepts; only lengths CSS understands. */
const hex = (v: string | true | undefined) => typeof v === 'string' && /^(?:[0-9a-f]{3,4}|[0-9a-f]{6})$/i.test(v) ? `#${v}` : undefined;
const num = (v: string | true | undefined, min: number, max: number, fallback: number) => {
  const n = typeof v === 'string' && v !== '' ? parseFloat(v) : NaN;
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};
const BORDER_STYLES = new Set(['hidden', 'dotted', 'dashed', 'solid', 'double', 'groove', 'ridge', 'inset', 'outset']);
const FONTS: [string, string][] = [['serif', 'serif'], ['monospace', 'monospace'], ['cursive', 'cursive'], ['fantasy', 'fantasy'], ['emoji', 'emoji'], ['math', 'math']];

/** Speed and delay for an animated function, as CSS variables its class reads. */
function timing(args: MfmArgs, speed: string): CSSProperties {
  return { '--mfm-speed': seconds(args.speed) ?? speed, '--mfm-delay': seconds(args.delay) ?? '0s' } as CSSProperties;
}

function fnView(name: string, args: MfmArgs, c: RichInline[], ctx: Ctx, scale: number): ReactNode {
  const kids = (s = scale) => inlines(c, ctx, s);
  if (!MFM_FUNCTIONS.has(name)) return <>{kids()}</>;
  const span = (className: string, style?: CSSProperties, s = scale) => <span className={`atlas-mfm ${className}`} style={style}>{kids(s)}</span>;
  switch (name) {
    case 'tada': return span('atlas-mfm-tada', timing(args, '1s'));
    case 'jelly': return span('atlas-mfm-jelly', timing(args, '1s'));
    case 'twitch': return span('atlas-mfm-twitch', timing(args, '0.5s'));
    case 'shake': return span('atlas-mfm-shake', timing(args, '0.5s'));
    case 'jump': return span('atlas-mfm-jump', timing(args, '0.75s'));
    case 'bounce': return span('atlas-mfm-bounce', timing(args, '0.75s'));
    case 'rainbow': return span('atlas-mfm-rainbow', timing(args, '1s'));
    case 'sparkle': return span('atlas-mfm-sparkle', timing(args, '1.5s'));
    case 'fade': return span(cx('atlas-mfm-fade', args.out && 'atlas-mfm-fade-out')!, { ...timing(args, '1.5s'), ...(typeof args.loop === 'string' && /^\d{1,3}$/.test(args.loop) ? { '--mfm-loop': args.loop } : {}) } as CSSProperties);
    case 'spin': {
      const axis = args.x ? 'atlas-mfm-spin-x' : args.y ? 'atlas-mfm-spin-y' : 'atlas-mfm-spin';
      const dir = args.left ? 'reverse' : args.alternate ? 'alternate' : 'normal';
      return span(axis, { ...timing(args, '1.5s'), '--mfm-direction': dir } as CSSProperties);
    }
    case 'flip': return span('atlas-mfm-static', { transform: args.h && args.v ? 'scale(-1, -1)' : args.v ? 'scaleY(-1)' : 'scaleX(-1)' });
    case 'x2': case 'x3': case 'x4': {
      // Size doubles only twice in a row, as in Misskey: deeper size functions add nothing.
      const factor = { x2: 2, x3: 3, x4: 4 }[name];
      if (scale >= 8) return <>{kids()}</>;
      return span(`atlas-mfm-${name}`, undefined, scale * factor);
    }
    case 'font': {
      const family = FONTS.find(([k]) => args[k])?.[1];
      return family ? span('atlas-mfm-font', { fontFamily: family }) : <>{kids()}</>;
    }
    case 'blur': return <span className="atlas-mfm atlas-mfm-blur" tabIndex={0}>{kids()}</span>;
    case 'rotate': return span('atlas-mfm-static', { transform: `rotate(${num(args.deg, -360, 360, 90)}deg)`, transformOrigin: 'center center' });
    case 'position': return span('atlas-mfm-static', { transform: `translate(${num(args.x, -2, 2, 0)}em, ${num(args.y, -2, 2, 0)}em)` });
    case 'scale': {
      const x = num(args.x, -5, 5, 1), y = num(args.y, -5, 5, 1);
      return span('atlas-mfm-static', { transform: `scale(${x}, ${y})` }, scale * Math.max(Math.abs(x), Math.abs(y), 1));
    }
    case 'fg': return span('atlas-mfm-color', { color: hex(args.color) ?? '#f00' });
    case 'bg': return span('atlas-mfm-color', { backgroundColor: hex(args.color) ?? '#f00' });
    case 'border': {
      const style = typeof args.style === 'string' && BORDER_STYLES.has(args.style) ? args.style : 'solid';
      const color = hex(args.color) ?? 'var(--accent, currentColor)';
      return span('atlas-mfm-static', { border: `${num(args.width, 0, 12, 1)}px ${style} ${color}`, borderRadius: `${num(args.radius, 0, 999, 0)}px`, ...(args.noclip ? {} : { overflow: 'clip' }) });
    }
    case 'crop': {
      const side = (k: string) => `${num(args[k], 0, 100, 0)}%`;
      return span('atlas-mfm-static', { clipPath: `inset(${side('top')} ${side('right')} ${side('bottom')} ${side('left')})` });
    }
    // ruby and unixtime arrive as their own nodes; clickable and followmouse act on input, which Atlas doesn't run.
    default: return <>{kids()}</>;
  }
}
