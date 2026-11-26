import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { tagRelay } from '../src/lib/fedibuzz';
import { actorFromWebfinger, parseHandle } from '../src/lib/article-author';

describe("FediBuzz's hashtag relays", () => {
  test("a tag's relay, named as buzzrelay names it", () => {
    expect(tagRelay('#Knitting')).toEqual({ key: 'knitting', acct: 'tag-knitting@relay.fedi.buzz', actor: 'https://relay.fedi.buzz/tag/knitting' });
    expect(tagRelay('mastoart')?.acct).toBe('tag-mastoart@relay.fedi.buzz');
    expect(tagRelay('photo_2026')?.key).toBe('photo_2026');
  });
  test('only tags the relay names exactly: never a transliterated or merged one', () => {
    // buzzrelay would deunicode these (日本 → riben, Café → cafe) or drop the hyphen: not the tag on screen.
    for (const t of ['日本', 'Café', 'open-source', 'two words', '', '#']) expect(tagRelay(t)).toBeNull();
  });
  test("the handle passes Atlas's handle check, and FediBuzz's WebFinger answer names the actor the follow confirms against", () => {
    const r = tagRelay('knitting')!;
    expect(parseHandle(r.acct)).toBe(r.acct);
    // As buzzrelay's webfinger() answers: subject, aliases [uri], a self link to the uri.
    expect(actorFromWebfinger({ subject: `acct:${r.acct}`, aliases: [r.actor], links: [{ rel: 'self', type: 'application/activity+json', href: r.actor }] })).toBe(r.actor);
  });
  test('both hashtag pages offer it only once the tag feed answered, through the confirmed-handle follow', () => {
    const desktop = readFileSync('src/routes/tags.$tag.tsx', 'utf8');
    const phone = readFileSync('src/components/f7/TagFeed.tsx', 'utf8');
    expect(desktop).toMatch(/\{feedOk && <TagRelayFollow tag=\{norm\} \/>\}/);
    expect(phone).toMatch(/\{feedOk && <MobileTagRelayFollow tag=\{tag\} \/>\}/);
    expect(readFileSync('src/components/social/TagRelayFollow.tsx', 'utf8')).toMatch(/useFediFollow\(relay\?\.acct, relay\?\.actor\)/);
  });
});
