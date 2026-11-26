import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { relayFromAcct, tagRelay } from '../src/lib/fedibuzz';
import { missingTagRelays } from '../src/lib/fedibuzz-follows.server';
import { fromStatuses } from '../src/lib/fedizen-feed';
import { actorFromWebfinger, parseHandle } from '../src/lib/article-author';

describe("FediBuzz's hashtag relays", () => {
  test("a tag's relay, named as buzzrelay names it", () => {
    expect(tagRelay('#PS5')).toEqual({ key: 'ps5', acct: 'tag-ps5@relay.fedi.buzz', actor: 'https://relay.fedi.buzz/tag/ps5' });
    expect(tagRelay('YouTube')?.acct).toBe('tag-youtube@relay.fedi.buzz');
    expect(tagRelay('photo_2026')?.key).toBe('photo_2026');
  });
  test('only tags the relay names exactly: never a transliterated or merged one', () => {
    // buzzrelay would deunicode these (日本 → riben, Café → cafe) or drop the hyphen: not the tag on screen.
    for (const t of ['日本', 'Café', 'open-source', 'two words', '', '#']) expect(tagRelay(t)).toBeNull();
  });
  test("the handle passes Atlas's handle check, and FediBuzz's WebFinger answer names the actor the follow confirms against", () => {
    const r = tagRelay('knitting')!;
    expect(parseHandle(r.acct)).toBe(r.acct);
    expect(actorFromWebfinger({ subject: `acct:${r.acct}`, aliases: [r.actor], links: [{ rel: 'self', type: 'application/activity+json', href: r.actor }] })).toBe(r.actor);
  });
});

describe('relays are where a post came from, not people', () => {
  test('relay accounts are recognised by their FediBuzz handle only', () => {
    expect(relayFromAcct('tag-ps5@relay.fedi.buzz')).toEqual({ kind: 'tag', value: 'ps5' });
    expect(relayFromAcct('@instance-bsky.brid.gy@relay.fedi.buzz')).toEqual({ kind: 'instance', value: 'bsky.brid.gy' });
    expect(relayFromAcct('language-de@relay.fedi.buzz')).toEqual({ kind: 'language', value: 'de' });
    expect(relayFromAcct('tag-ps5@relay.fedi.buzz.evil.example')).toBeNull();
    expect(relayFromAcct('ann@mastodon.social')).toBeNull();
  });
  test("a relay's boost reads as where it came from: no booster, no face on the new-posts pill", () => {
    const post = { id: 'p1', content: '<p>New game</p>', account: { acct: 'ann@mastodon.social', display_name: 'Ann' }, url: 'https://mastodon.social/@ann/1' };
    const [relayed, boosted] = fromStatuses([
      { id: 'b1', reblog: post, account: { acct: 'tag-ps5@relay.fedi.buzz', display_name: 'Relay for #ps5' } },
      { id: 'b2', reblog: post, account: { acct: 'ben@fedizen.net', display_name: 'Ben' } },
    ] as never);
    expect(relayed.relayed).toEqual({ kind: 'tag', value: 'ps5' });
    expect(relayed.boostedBy).toBeUndefined();
    expect(relayed.booster).toBeUndefined();
    expect(relayed.author).toBe('Ann');
    expect(boosted.boostedBy).toBe('Ben');
    expect(boosted.relayed).toBeUndefined();
  });
  test('the following count Atlas shows leaves relays out', () => {
    const src = readFileSync('src/components/social/useFedizenIdentity.ts', 'utf8');
    expect(src).toMatch(/following: viewer\.following === null \? null : Math\.max\(0, viewer\.following - relayCount\)/);
  });
});

describe('following a hashtag follows its relay behind the scenes', () => {
  test('hashtags followed earlier: only missing relays, only exact names, never twice, at most 10', () => {
    const follows = { relays: [{ kind: 'tag' as const, value: 'ps5' }, { kind: 'instance' as const, value: 'youtube' }], complete: true };
    expect(missingTagRelays(['PS5', 'YouTube', 'youtube', 'Café', 'open-source'], follows).map(r => r.key)).toEqual(['youtube']);
    expect(missingTagRelays(Array.from({ length: 30 }, (_, i) => `tag${i}`), { relays: [], complete: true })).toHaveLength(10);
  });
  test('the hashtag follow on the server also follows or unfollows the relay, after Fedizen took the hashtag', () => {
    const src = readFileSync('src/lib/fedizen.functions.ts', 'utf8');
    const fn = src.slice(src.indexOf('export const setTagFollow'), src.indexOf('export const getRelayFollows'));
    expect(fn.indexOf("fedizenSend(c.token, 'POST', `/api/v1/tags/")).toBeLessThan(fn.indexOf('await tagRelayFollow(context.userId, c.token, data.tag, data.on)'));
    expect(fn).toMatch(/if \(!notFound && \(r\.status < 200 \|\| r\.status >= 300\)\) return \{ ok: false/);
    // Followed only once FediBuzz's WebFinger names the relay; a sync waits for the whole following list.
    const server = readFileSync('src/lib/fedibuzz-follows.server.ts', 'utf8');
    expect(server).toMatch(/webfingerActor\(relay\.acct\)\.catch\(\(\) => null\)\) !== relay\.actor\) return 'failed'/);
    expect(src).toMatch(/if \(!tags \|\| tags\.status !== 200 \|\| !follows\.complete\) return \{ followed: 0 \}/);
  });
});
