import { describe, expect, test } from 'bun:test';
import { articleParagraphs, firstImageIn, fromBonfireArticles, withoutEscapedTags } from '../src/lib/spotlight';

// As Fedizen serves a Bridgy Fed web post (zerochan.net@web.brid.gy): the picture is markup escaped inside the summary.
const bridgy = {
  id: 'A1', canonicalUri: 'https://fedizen.net/post/A1',
  objectPostContent: { name: 'Genshin Impact', summary: '&lt;img src="https://s3.zerochan.net/240/42/08/4737942.avif" alt="" /&gt;', htmlBody: '' },
  subject: { character: { username: 'zerochan.net@web.brid.gy' }, profile: { name: 'Zerochan' } },
};

describe('article summaries with escaped markup', () => {
  test('the Bridgy Fed card: no markup as text, and its picture becomes the card image', () => {
    const [a] = fromBonfireArticles([bridgy]);
    expect(a.summary).toBe('');
    expect(a.image).toBe('https://s3.zerochan.net/240/42/08/4737942.avif');
  });

  test('an ordinary summary is unchanged, and real pictures win over the one in the text', () => {
    const [a] = fromBonfireArticles([{ ...bridgy, objectPostContent: { name: 'Chronixx', summary: 'Reggae star Chronixx &amp; friends', htmlBody: '' }, media: [{ url: 'https://cdn.example/p.jpg', mediaType: 'image/jpeg' }] }]);
    expect(a.summary).toBe('Reggae star Chronixx & friends');
    expect(a.image).toBe('https://cdn.example/p.jpg');
  });

  test('escaped tags go; prose with < and > stays', () => {
    expect(articleParagraphs('<p>Look &lt;a href="https://x.example"&gt;here&lt;/a&gt; now</p>')).toEqual(['Look here now']);
    expect(withoutEscapedTags('I <3 this, and 2 < 3 > 1')).toBe('I <3 this, and 2 < 3 > 1');
    expect(withoutEscapedTags('<imgx onerror=1>')).toBe('<imgx onerror=1>');
  });

  test('only https pictures are taken from the text', () => {
    expect(firstImageIn('<img src="http://plain.example/a.png">')).toBeUndefined();
    expect(firstImageIn('<img src="javascript:alert(1)">')).toBeUndefined();
    expect(firstImageIn('&lt;img alt="" src=\'https://ok.example/b.webp\'&gt;')).toBe('https://ok.example/b.webp');
  });
});
