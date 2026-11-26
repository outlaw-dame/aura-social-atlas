import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { findSpellings, initials, isSpelling } from '../src/lib/tag-variants';
import { tagLineFor } from '../src/components/social/useFeeds';

describe('other spellings of a followed hashtag', () => {
  test("a hashtag's initials, from how it's written", () => {
    expect(initials('PlayStation5')).toBe('ps5');
    expect(initials('PlayStation5Pro')).toBe('ps5p');
    expect(initials('PS5Pro')).toBe('ps5p');
    expect(initials('NintendoSwitch2')).toBe('ns2');
  });
  test('spellings: same start or end, the same initials, or the same letters in order ending in the same number', () => {
    for (const c of ['PS5Pro', 'PlayStation5', 'Playstation5', 'PlayStation5Pro', 'NewPS5']) expect(isSpelling('PS5', c)).toBe(true);
    expect(isSpelling('PlayStation5', 'PS5')).toBe(true);
    expect(isSpelling('YouTube', 'YouTubeShorts')).toBe(true);
    for (const c of ['Gaming', 'PS4', 'Sony', 'PS5', 'ps5']) expect(isSpelling('PS5', c)).toBe(false);
  });
  test('only spellings used together with it in at least two posts, most used first, only ones FediBuzz names exactly', () => {
    const posts = [
      '#PS5 #PS5Pro #Gaming', 'Great #PS5 game #PlayStation5 #Gaming', 'x #ps5 #PlayStation5 #PS5Pro',
      '#PS5 #Playstation5Pro #PlayStation5Pro', '#PS5 #PS5_Pro', 'once #PS5 #NewPS5', '#PS4 #PS4Pro #PS4Pro',
    ];
    // #PlayStation5Pro appears in one post only (twice, in two capitals): not enough.
    expect(findSpellings('ps5', posts)).toEqual(['ps5pro', 'playstation5']);
    // #Gaming is used together just as often, but isn't another way of writing #PS5.
    expect(findSpellings('ps5', posts)).not.toContain('gaming');
  });
  test('at most six', () => {
    const posts = Array.from({ length: 4 }, () => '#PS5 ' + Array.from({ length: 10 }, (_, i) => `#PS5x${i}`).join(' '));
    expect(findSpellings('ps5', posts)).toHaveLength(6);
  });
});

describe('a post brought in by a hashtag reads like any followed hashtag', () => {
  const followed = new Set(['ps5']);
  const variants = { ps5pro: 'ps5', playstation5: 'ps5' };
  test("its tag line is the hashtag followed: from the relay that brought it, or a spelling in its text", () => {
    expect(tagLineFor({ paragraphs: ['New console!'], relayed: { kind: 'tag', value: 'ps5' } }, followed, variants)).toEqual(['ps5']);
    expect(tagLineFor({ paragraphs: ['New console!'], relayed: { kind: 'tag', value: 'playstation5' } }, followed, variants)).toEqual(['ps5']);
    expect(tagLineFor({ paragraphs: ['Out now #PS5Pro #PlayStation5'] }, followed, variants)).toEqual(['ps5']);
    expect(tagLineFor({ paragraphs: ['Nothing here'], relayed: { kind: 'instance', value: 'social.vivaldi.net' } }, followed, variants)).toEqual([]);
  });
  test('no "From #tag" line: the tag line takes its place; servers and languages still say where', () => {
    const src = readFileSync('src/components/social/PostPeople.tsx', 'utf8');
    expect(src).toMatch(/if \(r\.kind === 'tag'\) return null;/);
    expect(src).toMatch(/From <b>\{r\.value\}<\/b>/);
  });
});

describe('spellings come and go with the hashtag', () => {
  test('following a hashtag follows its spellings; unfollowing removes them unless still needed', () => {
    const fns = readFileSync('src/lib/fedizen.functions.ts', 'utf8');
    expect(fns).toMatch(/if \(on\) await f\.followSpellings\(userId, token, tag\)/);
    expect(fns).toMatch(/await f\.unfollowSpellings\(userId, token, tag, followed\)/);
    const server = readFileSync('src/lib/fedibuzz-follows.server.ts', 'utf8');
    // Kept: any another followed hashtag brings in, or followed as a hashtag of its own.
    expect(server).toMatch(/const keep = new Set\(\[\.\.\.followedTags\.map\(t => t\.toLowerCase\(\)\), \.\.\.\[\.\.\.all\.entries\(\)\]\.filter\(\(\[t\]\) => t !== key\)\.flatMap\(\(\[, v\]\) => v\)\]\);/);
    // Only relays FediBuzz's WebFinger confirms are followed (followRelay), and only what was followed is kept.
    expect(server).toMatch(/if \(state === 'following' \|\| state === 'requested'\) followedRelays\.push\(v\);/);
  });
  test('the table is server-only', () => {
    const sql = readFileSync('supabase/migrations/20261126020000_tag_variants.sql', 'utf8');
    expect(sql).toMatch(/enable row level security/);
    expect(sql).toMatch(/revoke all on public\.atlas_tag_variants from anon, authenticated/);
    expect(sql).toMatch(/cardinality\(variants\) <= 6/);
  });
});

describe('review fixes', () => {
  test('one post using a spelling twice, in different capitals, is still one use', () => {
    expect(findSpellings('ps5', ['#PS5 #Playstation5Pro #PlayStation5Pro'])).toEqual([]);
    expect(findSpellings('ps5', ['#PS5 #Playstation5Pro #PlayStation5Pro', '#PS5 #PlayStation5Pro'])).toEqual(['playstation5pro']);
  });
  test("unfollowing a hashtag keeps its relay while another followed hashtag brings it in as a spelling", () => {
    const fns = readFileSync('src/lib/fedizen.functions.ts', 'utf8');
    expect(fns).toMatch(/if \(relay && !on && !\(await f\.neededAsSpelling\(userId, relay\.key\)\)\) await f\.followRelay\(token, relay, false\)/);
    const server = readFileSync('src/lib/fedibuzz-follows.server.ts', 'utf8');
    expect(server).toMatch(/for \(const \[t, vs\] of await storedVariants\(userId\)\) if \(t !== key && vs\.includes\(key\)\) return true;/);
  });
});
