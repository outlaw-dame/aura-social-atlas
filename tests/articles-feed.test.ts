import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { isFeedCursor, publicFeedDocument } from '../src/lib/bonfire/graphql/operations';
import { articleTitle, fromBonfireArticles } from '../src/lib/spotlight';

describe('the Articles feed', () => {
  test('pages through Fedizen’s articles feed by its cursor', () => {
    expect(publicFeedDocument('articles')).toContain('feedActivities(first:20,filter:{feedName:"articles"})');
    expect(publicFeedDocument('articles')).toContain('pageInfo{hasNextPage endCursor}');
    expect(publicFeedDocument('articles', '01KB2Y8Z3Q5RJ6M7N8P9T0VWXY')).toContain('feedActivities(first:20,after:"01KB2Y8Z3Q5RJ6M7N8P9T0VWXY",');
  });
  test('a cursor can’t change the query it goes into', () => {
    expect(isFeedCursor('01KB2Y8Z3Q5RJ6M7N8P9T0VWXY')).toBe(true);
    expect(isFeedCursor('x"){__typename}#')).toBe(false);
    expect(isFeedCursor('')).toBe(false);
    expect(isFeedCursor('a'.repeat(201))).toBe(false);
  });
  test('titles as text: entities decoded, BookWyrm’s “: None” dropped', () => {
    expect(articleTitle('Review of &quot;La conjura de los necios&quot; (4 stars): None')).toBe('Review of "La conjura de los necios" (4 stars)');
    expect(articleTitle('Review of &quot;Dune&quot; (4.5 stars): A classic')).toBe('Review of "Dune" (4.5 stars): A classic');
    expect(articleTitle('Rock &amp; Roll <em>History</em>')).toBe('Rock & Roll History');
    expect(articleTitle('Why None of This Works')).toBe('Why None of This Works');
    expect(articleTitle('  ')).toBeUndefined();
    const [a] = fromBonfireArticles([{ id: '1', objectPostContent: { name: 'Q&amp;A', htmlBody: '<p>Body</p>' } } as never]);
    expect(a!.title).toBe('Q&A');
  });
  test('the Articles tab shows every page loaded, with More articles; Discover keeps its preview', () => {
    expect(readFileSync('src/components/social/FeedsView.tsx', 'utf8')).toContain("{feed === 'articles' && <RecentArticles full />}");
    expect(readFileSync('src/components/f7/MobileFeeds.tsx', 'utf8')).toContain("{feed === 'articles' && <MobileRecentArticles full />}");
    const desk = readFileSync('src/components/social/RecentArticles.tsx', 'utf8');
    expect(desk).toContain('const articles = full ? a$.articles : a$.articles.slice(0, 9);');
    expect(desk).toContain("'More articles'");
  });
});
