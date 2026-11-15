/**
 * Live acceptance for Atlas's ACTUAL public Bonfire client queries.
 *
 * Execute from an authorized network-connected environment:
 *   bun scripts/probe-fedizen-public-client.ts
 *
 * Uses existing application request documents and response validators; avoids
 * a duplicate GraphQL projection. Public anonymous feeds only. Never prints
 * content, author IDs, URLs, errors from the remote host, or credentials.
 */
import { fetchPublicFeed, fetchRecentArticles } from '../src/lib/bonfire.server';

let failures = 0;

async function check(name: 'local' | 'articles') {
  try {
    const result = name === 'local'
      ? await fetchPublicFeed()
      : await fetchRecentArticles();
    const unavailable = result.error === 'unavailable';
    const count = 'posts' in result ? result.posts.length : result.articles.length;
    console.log(JSON.stringify({
      feedName: name,
      projection: 'atlas-public-client',
      status: unavailable ? 'unavailable' : 'accepted',
      items: count,
    }));
    if (unavailable) failures++;
  } catch {
    failures++;
    console.log(JSON.stringify({
      feedName: name, projection: 'atlas-public-client', status: 'client-validation-failure',
    }));
  }
}

await check('local');
await check('articles');
if (failures) process.exitCode = 1;
