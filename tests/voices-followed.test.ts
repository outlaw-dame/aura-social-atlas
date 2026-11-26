import { afterEach, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { _clearVoiceCaches, allVoices } from '../src/lib/voices.server';
import { notFollowed } from '../src/components/social/VoicesToKnow';
import { fullAcct } from '../src/lib/fedibuzz-follows.server';
import type { Voice } from '../src/lib/voices';

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; _clearVoiceCaches(); });

describe('Inkwell writers in Voices to know', () => {
  test("Inkwell's public writers directory, as Inkwell answers it: writers with a few entries, most-inked first", async () => {
    const asked: string[] = [];
    globalThis.fetch = (async (url: string) => {
      asked.push(String(url));
      if (String(url) !== 'https://api.inkwell.social/api/explore/writers?limit=12') return new Response('no', { status: 404 });
      return Response.json({ data: [
        { username: 'michael', display_name: 'Michael', avatar_url: '/api/avatars/michael?v=1', bio: 'Loves <b>technology</b>.', entry_count: 23, ink_count: 14 },
        { username: 'thequietbambi', display_name: 'thequietbambi', avatar_url: '/api/avatars/thequietbambi?v=1', bio: 'Halfway across.', entry_count: 7, ink_count: 11 },
        { username: 'newcomer', display_name: 'New', avatar_url: null, bio: null, entry_count: 1, ink_count: 40 },
        { username: 'bad name', display_name: 'Bad', entry_count: 9, ink_count: 99 },
        { username: 'evil', display_name: 'Evil', avatar_url: 'https://tracker.example/pixel.gif', bio: '', entry_count: 5, ink_count: 1 },
      ] });
    }) as unknown as typeof fetch;
    const { voices, sources } = await allVoices();
    expect(sources.inkwell).toBe(true);
    const ink = voices.filter(v => v.network === 'Inkwell');
    expect(ink.map(v => v.handle)).toEqual(['@michael@inkwell.social', '@thequietbambi@inkwell.social', '@evil@inkwell.social']);
    expect(ink[0]).toMatchObject({ category: 'writer', name: 'Michael', bio: 'Loves technology.', url: 'https://inkwell.social/michael', avatar: 'https://api.inkwell.social/api/avatars/michael?v=1' });
    // An avatar anywhere but Inkwell's own API host isn't used.
    expect(ink[2].avatar).toBeUndefined();
  });
});

describe('Voices to know leaves out who you already follow', () => {
  const v = (handle: string): Voice => ({ id: handle, name: handle, handle, network: 'Mastodon', topic: '', bio: '', url: 'https://example.org' });
  test('matched by full handle, case aside; voices without a handle stay', () => {
    const list = [v('@Ann@mastodon.social'), v('@bea@fedizen.net'), v('@cy@inkwell.social'), v('not a handle')];
    expect(notFollowed(list, ['ann@mastodon.social', 'bea@fedizen.net']).map(x => x.handle)).toEqual(['@cy@inkwell.social', 'not a handle']);
    expect(notFollowed(list, undefined)).toHaveLength(4);
  });
  test("Fedizen's local accounts have no domain in acct: they're Fedizen's", () => {
    expect(fullAcct('Bea')).toBe('bea@fedizen.net');
    expect(fullAcct('@ann@Mastodon.Social')).toBe('ann@mastodon.social');
    expect(fullAcct('')).toBeNull();
  });
  test('relays never count as people followed; following someone from a profile refreshes the list', () => {
    const fns = readFileSync('src/lib/fedizen.functions.ts', 'utf8');
    expect(fns).toMatch(/handles: f\.accts\.filter\(a => !relayFromAcct\(a\)\)/);
    expect(readFileSync('src/lib/fedi-profile.functions.ts', 'utf8')).toMatch(/forgetRelayFollows\(context\.userId\)/);
    expect(readFileSync('src/components/social/useFediProfile.ts', 'utf8')).toMatch(/invalidateQueries\(\{ queryKey: \['fedizen-followed-handles', id\] \}\)/);
  });
});

describe('the Voices list kept for a day', () => {
  test('only a list every source answered for is kept or reused; one with Inkwell down is read fresh after a restart', () => {
    const src = readFileSync('src/lib/voices.server.ts', 'utf8');
    expect(src).toMatch(/const complete = \(s: [^)]*\) => !!s\?\.fedidb && !!s\.castopodIndex && s\.inkwell === true;/);
    expect(src).toMatch(/if \(kept && Array\.isArray\(kept\.voices\) && complete\(kept\.sources\)\) return kept;/);
    expect(src).toMatch(/if \(complete\(result\.sources\)\) writeLookup\('voices', 'all'/);
  });
});
