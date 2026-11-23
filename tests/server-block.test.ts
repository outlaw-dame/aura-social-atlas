import { afterEach, describe, expect, test } from 'bun:test';
import { changeServerBlock, serverIdFor } from '../src/lib/server-block.server';

// Bonfire's answers are imitated with a stubbed fetch; ids and servers are invented.
const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });
const answer = (body: unknown) => { globalThis.fetch = (async () => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })) as unknown as typeof fetch; };
let n = 0;
const token = () => `test-token-${++n}`; // a fresh account each time, so no rate-limit or read cache carries over

describe('blocking a whole server through Bonfire', () => {
  test("the server's id, only when the account's own address is on that server", async () => {
    answer({ data: { user: { id: 'u1', character: { username: 'ann@lemmy.example', peered: { peerId: 'PEER1', canonicalUri: 'https://lemmy.example/u/ann' } } } } });
    expect(await serverIdFor('ann@lemmy.example')).toBe('PEER1');
    answer({ data: { user: { id: 'u1', character: { username: 'ann@social.example', peered: { peerId: 'PEER2', canonicalUri: 'https://mastodon.social.example/users/ann' } } } } });
    expect(await serverIdFor('ann@social.example')).toBe('PEER2');
    answer({ data: { user: { id: 'u1', character: { username: 'ann@lemmy.example', peered: { peerId: 'PEER3', canonicalUri: 'https://elsewhere.example/u/ann' } } } } });
    expect(await serverIdFor('ann@lemmy.example')).toBeNull();
    answer({ data: { user: { id: 'u1', character: { username: 'ann@social.example', peered: { peerId: 'TOO_WIDE', canonicalUri: 'https://example/users/ann' } } } } });
    expect(await serverIdFor('ann@social.example')).toBeNull();
    for (const uri of ['http://lemmy.example/u/ann', 'https://u:p@lemmy.example/u/ann', 'https://lemmy.example:444/u/ann']) {
      answer({ data: { user: { id: 'u1', character: { username: 'ann@lemmy.example', peered: { peerId: 'UNSAFE', canonicalUri: uri } } } } });
      expect(await serverIdFor('ann@lemmy.example')).toBeNull();
    }
    answer({ data: { user: { id: 'u1', character: { username: 'me', peered: null } } } });
    expect(await serverIdFor('me@fedizen.example')).toBeNull();
  });

  test("Bonfire's errors for a server block say nothing (a block that worked answers \"Could not block user\")", async () => {
    answer({ data: { blockUser: { id: 'PEER1' } } });
    expect(await changeServerBlock(token(), 'PEER1', true)).toBe('done');
    answer({ data: { blockUser: null }, errors: [{ message: 'Could not block user' }] });
    expect(await changeServerBlock(token(), 'PEER1', true)).toBe('unconfirmed');
    answer({ data: { unblockUser: null }, errors: [{ message: 'not_found' }] });
    expect(await changeServerBlock(token(), 'PEER1', false)).toBe('unconfirmed');
  });
});
