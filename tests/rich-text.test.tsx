import { describe, test } from 'node:test';
import { deepStrictEqual, ok, strictEqual } from 'node:assert';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { decodeEntities, emojiMap, hasFormatting, htmlToRich, richText, type RichBlock } from '../src/lib/rich-text';
import { mfmSourceOf, mfmToRich } from '../src/lib/mfm';
import { postsFromOutbox } from '../src/lib/fedi-profile';
import { PostBody } from '../src/components/social/PostBody';

const draw = (rich: RichBlock[] | undefined, paragraphs: string[] = [], emojis?: ReturnType<typeof emojiMap>) =>
  renderToStaticMarkup(createElement(PostBody, { post: { paragraphs, rich, emojis }, onTag: () => {} }));

describe('remote HTML → post formatting', () => {
  test('plain Mastodon posts need no model: their paragraphs show them', () => {
    strictEqual(htmlToRich('<p>Hello <a href="https://m.example/@a" class="u-url mention">@<span>a</span></a></p><p>Two<br>lines</p>'), undefined);
    strictEqual(htmlToRich('<p><a href="https://example.org/a/long/path" rel="nofollow"><span class="invisible">https://</span><span class="ellipsis">example.org/a/lo</span><span class="invisible">ng/path</span></a> <a href="https://m.example/tags/x" class="mention hashtag">#<span>x</span></a></p>'), undefined);
    strictEqual(htmlToRich(''), undefined);
  });
  test('bold, italics, strike, code, quotes, lists and code blocks', () => {
    const r = htmlToRich('<p><strong>B</strong> <em>i</em> <del>s</del> <code>x()</code></p><blockquote><p>q</p></blockquote><ul><li>one</li><li><p>two</p></li></ul><pre><code class="language-ts">a\n  b</code></pre>')!;
    deepStrictEqual(r[0], { t: 'p', c: [{ t: 'b', c: [{ t: 'text', v: 'B' }] }, { t: 'text', v: ' ' }, { t: 'i', c: [{ t: 'text', v: 'i' }] }, { t: 'text', v: ' ' }, { t: 's', c: [{ t: 'text', v: 's' }] }, { t: 'text', v: ' ' }, { t: 'code', v: 'x()' }] });
    deepStrictEqual(r[1], { t: 'quote', c: [{ t: 'p', c: [{ t: 'text', v: 'q' }] }] });
    deepStrictEqual(r[2], { t: 'list', ordered: false, items: [[{ t: 'p', c: [{ t: 'text', v: 'one' }] }], [{ t: 'p', c: [{ t: 'text', v: 'two' }] }]] });
    deepStrictEqual(r[3], { t: 'pre', v: 'a\n  b', lang: 'ts' });
  });
  test('MFM functions encoded per FEP-c16b, and in the earlier _mfm_ form', () => {
    const r = htmlToRich('<p><span class="mfm-jelly" data-mfm-speed="2s">j</span> <span class="mfm-spin" data-mfm-x data-mfm-speed="0.5s">s</span> <span class="mfm _mfm_x2_">big</span> <span class="_mfm_spin_" data-y="">old</span></p>')!;
    const fns = r[0].t === 'p' ? r[0].c.filter(x => x.t === 'fn') : [];
    deepStrictEqual(fns, [
      { t: 'fn', name: 'jelly', args: { speed: '2s' }, c: [{ t: 'text', v: 'j' }] },
      { t: 'fn', name: 'spin', args: { x: true, speed: '0.5s' }, c: [{ t: 'text', v: 's' }] },
      { t: 'fn', name: 'x2', args: {}, c: [{ t: 'text', v: 'big' }] },
      { t: 'fn', name: 'spin', args: { y: true }, c: [{ t: 'text', v: 'old' }] },
    ]);
  });
  test("Misskey's own HTML: ruby, unixtime, centre", () => {
    const r = htmlToRich('<p><ruby>漢字<rp>(</rp><rt>かんじ</rt><rp>)</rp></ruby> <time datetime="2023-11-14T22:13:20.000Z">2023-11-14T22:13:20.000Z</time></p><div style="text-align: center;">mid</div>')!;
    deepStrictEqual(r[0], { t: 'p', c: [{ t: 'ruby', c: [{ t: 'text', v: '漢字' }], rt: 'かんじ' }, { t: 'text', v: ' ' }, { t: 'time', iso: '2023-11-14T22:13:20.000Z' }] });
    deepStrictEqual(r[1], { t: 'center', c: [{ t: 'p', c: [{ t: 'text', v: 'mid' }] }] });
  });
  test('nothing executable survives: scripts, styles, event handlers, javascript: links', () => {
    const r = htmlToRich('<p><b onclick="x()">ok</b><script>alert(1)</script><style>p{}</style><a href="javascript:alert(1)">click me</a><img src=x onerror="alert(1)"></p>')!;
    strictEqual(richText(r), 'okclick me');
    const out = draw(r);
    ok(!/onclick|onerror|script|javascript/i.test(out), out);
  });
  test('a link whose words differ from its address stays a link, to http(s) only', () => {
    const r = htmlToRich('<p>See <a href="https://example.org/doc">the docs</a></p>')!;
    deepStrictEqual(r[0], { t: 'p', c: [{ t: 'text', v: 'See ' }, { t: 'link', href: 'https://example.org/doc', c: [{ t: 'text', v: 'the docs' }] }] });
  });
  test('character references decode as browsers do', () => {
    strictEqual(decodeEntities('&#128512; &#x1F600; &amp; &lt;b&gt; &#0; &#xD800; &bogus;'), '😀 😀 & <b> � � &bogus;');
  });
  test('custom emoji images become emoji', () => {
    const r = htmlToRich('<p>hi <img class="emoji" alt=":blob:" src="https://e.example/blob.png"></p>')!;
    deepStrictEqual(r[0], { t: 'p', c: [{ t: 'text', v: 'hi ' }, { t: 'emoji', name: 'blob' }] });
  });
  test('hostile nesting and size are bounded', () => {
    const deep = '<span class="mfm-x2">'.repeat(5000) + 'x' + '</span>'.repeat(5000);
    const r = htmlToRich(`<p>${deep}</p>`);
    ok(r && richText(r).length <= 1);
    ok(htmlToRich('<b>a</b>'.repeat(100_000)));
  });
});

describe('MFM source → post formatting', () => {
  test('functions, emphasis, paragraphs and line breaks', () => {
    const r = mfmToRich('$[spin.x,speed=0.5s hi] **b**\nnext line\n\nnew para')!;
    deepStrictEqual(r, [
      { t: 'p', c: [{ t: 'fn', name: 'spin', args: { x: true, speed: '0.5s' }, c: [{ t: 'text', v: 'hi' }] }, { t: 'text', v: ' ' }, { t: 'b', c: [{ t: 'text', v: 'b' }] }, { t: 'br' }, { t: 'text', v: 'next line' }] },
      { t: 'p', c: [{ t: 'text', v: 'new para' }] },
    ]);
  });
  test('ruby, unixtime, links, code, quotes and centre', () => {
    const r = mfmToRich('$[ruby 漢字 かんじ] $[unixtime 1700000000] [docs](https://example.org) [x](javascript:alert(1))\n```js\nlet a\n```\n> quoted\n<center>mid</center>')!;
    const p = r[0];
    ok(p.t === 'p');
    deepStrictEqual(p.c.slice(0, 5), [
      { t: 'ruby', c: [{ t: 'text', v: '漢字' }], rt: 'かんじ' }, { t: 'text', v: ' ' },
      { t: 'time', iso: '2023-11-14T22:13:20.000Z' }, { t: 'text', v: ' ' },
      { t: 'link', href: 'https://example.org/', c: [{ t: 'text', v: 'docs' }] },
    ]);
    ok(!JSON.stringify(r).includes('"href":"javascript'));
    ok(r.some(b => b.t === 'pre' && b.v === 'let a' && b.lang === 'js'));
    ok(r.some(b => b.t === 'quote'));
    ok(r.some(b => b.t === 'center'));
  });
  test('mentions, hashtags and emoji stay text, to be made live when drawn', () => {
    strictEqual(mfmToRich('@a@b.example #tag :blob:'), undefined);
    strictEqual(richText(mfmToRich('**x** @a@b.example #tag :blob:')!), 'x @a@b.example #tag :blob:');
  });
  test('the source comes from source.mediaType, or the older _misskey_content', () => {
    strictEqual(mfmSourceOf({ source: { content: '$[x2 a]', mediaType: 'text/x.misskeymarkdown' } }), '$[x2 a]');
    strictEqual(mfmSourceOf({ source: { content: '# md', mediaType: 'text/markdown' } }), undefined);
    strictEqual(mfmSourceOf({ _misskey_content: '$[x2 a]' }), '$[x2 a]');
  });
  test('a Misskey outbox post is drawn from its MFM source', () => {
    const actor = 'https://mk.example.org/users/a';
    const page = { orderedItems: [{ type: 'Create', to: ['https://www.w3.org/ns/activitystreams#Public'], object: {
      id: 'https://mk.example.org/notes/1', type: 'Note', attributedTo: actor, to: ['https://www.w3.org/ns/activitystreams#Public'],
      content: '<p><i>spin</i> :blob:</p>', source: { content: '$[spin spin] :blob:', mediaType: 'text/x.misskeymarkdown' },
      tag: [{ type: 'Emoji', name: ':blob:', icon: { url: 'https://mk.example.org/e/blob.webp' } }],
    } }] };
    const [post] = postsFromOutbox(page, actor, 10, o => { const s = mfmSourceOf(o); return s ? mfmToRich(s) : undefined; });
    strictEqual(post.rich?.[0].t, 'p');
    ok(JSON.stringify(post.rich).includes('"name":"spin"'));
    deepStrictEqual(post.emojis, { blob: { url: 'https://mk.example.org/e/blob.webp' } });
  });
});

describe('custom emoji lists', () => {
  test("Mastodon's and ActivityPub's forms; https images and sane shortcodes only", () => {
    deepStrictEqual(emojiMap([
      { shortcode: 'a', url: 'https://x.example/a.gif', static_url: 'https://x.example/a.png' },
      { type: 'Emoji', name: ':b:', icon: { url: 'https://x.example/b.png' } },
      { shortcode: 'c', url: 'http://x.example/c.png' },
      { shortcode: 'bad code', url: 'https://x.example/d.png' },
      { shortcode: 'e', url: 'javascript:alert(1)' },
    ]), { a: { url: 'https://x.example/a.gif', staticUrl: 'https://x.example/a.png' }, b: { url: 'https://x.example/b.png' } });
    strictEqual(emojiMap([]), undefined);
  });
});

describe('drawing', () => {
  test('formatting is drawn as elements, with no remote markup', () => {
    const out = draw(htmlToRich('<p><strong>B</strong> <code>c</code></p><pre>x</pre>'));
    ok(out.includes('<strong>B</strong>') && out.includes('<code class="atlas-rt-code">c</code>') && out.includes('<pre class="atlas-rt-pre" tabindex="0"><code>x</code></pre>'), out);
  });
  test('MFM arguments are checked before they reach a style', () => {
    const out = draw([{ t: 'p', c: [
      { t: 'fn', name: 'jelly', args: { speed: '1s;color:red' }, c: [{ t: 'text', v: 'a' }] },
      { t: 'fn', name: 'fg', args: { color: 'f00;background:url(x)' }, c: [{ t: 'text', v: 'b' }] },
      { t: 'fn', name: 'position', args: { x: '999', y: '-999' }, c: [{ t: 'text', v: 'c' }] },
      { t: 'fn', name: 'border', args: { style: 'solid;x', width: '9999', color: '0f0' }, c: [{ t: 'text', v: 'd' }] },
    ] }]);
    ok(out.includes('--mfm-speed:1s'), out);
    ok(!out.includes('color:red') && !out.includes('url(x)'), out);
    ok(out.includes('color:#f00'), out);
    ok(out.includes('translate(2em, -2em)'), out);
    ok(out.includes('border:12px solid #0f0'), out);
    ok(out.includes('class="atlas-mfm-fx"'), out);
  });
  test("an unknown function shows its content; clickable doesn't act", () => {
    strictEqual(draw([{ t: 'p', c: [{ t: 'fn', name: 'nonsense', args: {}, c: [{ t: 'text', v: 'kept' }] }] }]), '<p class="atlas-mfm-fx">kept</p>');
    ok(!draw([{ t: 'p', c: [{ t: 'fn', name: 'clickable', args: { ev: 'x' }, c: [{ t: 'text', v: 'k' }] }] }]).includes('onclick'));
  });
  test('custom emoji in plain paragraphs, with a still image for Reduce Motion', () => {
    const out = draw(undefined, ['hi :a: :zz:'], emojiMap([{ shortcode: 'a', url: 'https://x.example/a.gif', static_url: 'https://x.example/a.png' }]));
    ok(out.includes('<source media="(prefers-reduced-motion: reduce)" srcSet="https://x.example/a.png"/>'), out);
    ok(out.includes('alt=":a:"') && out.includes(':zz:'), out);
  });
  test('hasFormatting', () => {
    strictEqual(hasFormatting([{ t: 'p', c: [{ t: 'text', v: 'a' }, { t: 'br' }] }]), false);
    strictEqual(hasFormatting([{ t: 'quote', c: [] }]), true);
  });
});

describe("Fedizen's statuses keep their custom emoji", () => {
  test('emojis pass the status schema and reach the post', async () => {
    const { liveStatus } = await import('../src/lib/fedizen.server');
    const { fromStatuses } = await import('../src/lib/fedizen-feed');
    const raw = liveStatus({ id: '1', content: '<p>hi :blob:</p>', emojis: [{ shortcode: 'blob', url: 'https://x.example.org/b.png', static_url: 'https://x.example.org/b.png' }] });
    ok(raw);
    deepStrictEqual(fromStatuses([raw as never])[0].emojis, { blob: { url: 'https://x.example.org/b.png' } });
  });
});
