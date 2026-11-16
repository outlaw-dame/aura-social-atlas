import { describe, expect, test } from 'bun:test';
import { parsePagePreview } from '../src/lib/article-author';

describe('link previews from the page itself', () => {
  test('Open Graph first, plain text, image made absolute', () => {
    const html = `<html><head><title>Fallback</title>
      <meta property="og:title" content="Apple&#39;s &amp; Wallet chief">
      <meta property="og:description" content="&lt;b&gt;Bloomberg&lt;/b&gt; reports">
      <meta property="og:site_name" content="9to5Mac">
      <meta property="og:image" content="/img/a.jpg"></head><body></body></html>`;
    expect(parsePagePreview(html, 'https://9to5mac.com/x')).toEqual({ title: "Apple's & Wallet chief", description: 'Bloomberg reports', image: 'https://9to5mac.com/img/a.jpg', provider: '9to5Mac' });
  });
  test('Twitter cards, then <title>', () => {
    expect(parsePagePreview('<head><meta name="twitter:title" content="T"></head>', 'https://a.example/')?.title).toBe('T');
    expect(parsePagePreview('<head><title> Just a title </title></head>', 'https://a.example/')).toEqual({ title: 'Just a title' });
  });
  test('no title, no preview; unsafe images dropped', () => {
    expect(parsePagePreview('<head></head>', 'https://a.example/')).toBeNull();
    expect(parsePagePreview('<head><title>x</title><meta property="og:image" content="http://127.0.0.1/a.png"></head>', 'https://a.example/')).toEqual({ title: 'x' });
  });
});
