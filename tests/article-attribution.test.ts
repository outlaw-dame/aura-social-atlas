import { afterEach, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { _clearOrigins, originDeps, originOf, pageOf } from '../src/lib/article-origins.server';
import { foldCredits } from '../src/lib/fedizen-feed';

const real = originDeps.safeFetch;
afterEach(() => { originDeps.safeFetch = real; _clearOrigins(); });
const pub = 'https://fedizen.net/pub/objects/01KB2Y8Z3Q5RJ6M7N8P9T0VWXY';

describe('where a Fedizen article was published', () => {
  test("its page: the object's url (a string, a Link, the HTML one), else its id; never Fedizen", () => {
    expect(pageOf({ id: 'https://someblog.wordpress.com/?p=1', url: 'https://someblog.wordpress.com/2026/11/post/' })).toBe('https://someblog.wordpress.com/2026/11/post/');
    expect(pageOf({ id: 'https://writer.writefreely.host/a/1', url: [{ type: 'Link', href: 'https://writer.writefreely.host/a.json', mediaType: 'application/json' }, { type: 'Link', href: 'https://writer.writefreely.host/a', mediaType: 'text/html' }] })).toBe('https://writer.writefreely.host/a');
    expect(pageOf({ id: 'https://writer.writefreely.host/a/1' })).toBe('https://writer.writefreely.host/a/1');
    expect(pageOf({ id: 'https://fedizen.net/pub/objects/x', url: 'javascript:alert(1)' })).toBeUndefined();
  });
  test('read from Fedizen as ActivityPub, only for its /pub/objects addresses and article-like objects; kept', async () => {
    let calls = 0;
    originDeps.safeFetch = async (url, accept) => { calls++; expect(url).toBe(pub); expect(accept).toBe('application/activity+json');
      return { url, type: 'application/activity+json', text: JSON.stringify({ type: 'Article', id: 'https://someblog.wordpress.com/?p=1', url: 'https://someblog.wordpress.com/post/' }) }; };
    expect(await originOf(pub)).toBe('https://someblog.wordpress.com/post/');
    expect(await originOf(pub)).toBe('https://someblog.wordpress.com/post/');
    expect(calls).toBe(1);
    expect(await originOf('https://fedizen.net/discussion/01X')).toBeNull();
    expect(await originOf('https://evil.example/pub/objects/1')).toBeNull();
    expect(calls).toBe(1);
  });
  test('an unreadable or non-article answer is no origin', async () => {
    originDeps.safeFetch = async () => null;
    expect(await originOf(pub)).toBeNull();
    _clearOrigins();
    originDeps.safeFetch = async url => ({ url, type: 'application/activity+json', text: JSON.stringify({ type: 'Person', id: 'https://x.example/u' }) });
    expect(await originOf(pub)).toBeNull();
  });
});

describe('author attribution on articles', () => {
  test('the Articles feed resolves authors on each original page; readers show them and link the original', () => {
    expect(readFileSync('src/lib/bonfire.server.ts', 'utf8')).toContain('withOriginsAndAuthors(page.items)');
    expect(readFileSync('src/lib/article-origins.server.ts', 'utf8')).toContain('resolveAuthorsFor(p, left)');
    expect(readFileSync('src/components/social/RecentArticles.tsx', 'utf8')).toContain('<AuthorCards authors={open.authors} />');
    expect(readFileSync('src/components/f7/FedizenMobile.tsx', 'utf8')).toContain('<AuthorRows authors={open.authors} />');
  });
  test('a folded long-form post shows its verified credits: its own page’s, else its card’s', () => {
    const a = { name: 'Jo', acct: '@jo@x.example', url: 'https://x.example/@jo' };
    const lf = { title: 'T', lede: 'L' };
    expect(foldCredits({ longform: lf, credits: [a] })).toEqual([a]);
    expect(foldCredits({ longform: lf, article: { url: 'https://x.example/p', authors: [a] } })).toEqual([a]);
    expect(foldCredits({ credits: [a] })).toEqual([]);
    expect(readFileSync('src/lib/feed-enrich.server.ts', 'utf8')).toContain("p.longform && !p.article");
  });
});
