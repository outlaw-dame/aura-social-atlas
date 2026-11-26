import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { originOf, originReplies, repliesFedizenLacks } from '../src/lib/origin-replies';
import { buildThread } from '../src/lib/thread';
import type { FedizenPost } from '../src/lib/fedizen-feed';

const status = (id: string, replyTo: string | null, extra: Record<string, unknown> = {}) => ({
  id, in_reply_to_id: replyTo, visibility: 'public', uri: `https://mastodon.example/users/a/statuses/${id}`, url: `https://mastodon.example/@a/${id}`,
  content: `<p>reply ${id}</p>`, account: { acct: 'ann@mastodon.example', display_name: 'Ann' }, created_at: '2026-11-25T20:00:00Z', ...extra,
});

describe("replies from the post's own server", () => {
  test("the post's own server and id, from Mastodon's addresses only", () => {
    expect(originOf('https://mastodon.example/@ann/113000000000000001')).toEqual({ host: 'mastodon.example', id: '113000000000000001' });
    expect(originOf('https://Mastodon.Example/users/ann/statuses/42')).toEqual({ host: 'mastodon.example', id: '42' });
    for (const u of ['http://mastodon.example/@ann/1', 'https://mastodon.example/@ann/1?x=1', 'https://bsky.app/profile/a/post/3k', 'https://mastodon.example/notes/abc', undefined]) expect(originOf(u)).toBeNull();
  });

  test('only public and unlisted replies, ids checked, as Atlas posts', () => {
    const r = originReplies([status('10', '1'), status('11', '1', { visibility: 'private' }), status('12', '1', { visibility: 'direct' }), { id: 'x', visibility: 'public' }, null]);
    expect(r.map(x => x.id)).toEqual(['10']);
    expect(r[0]).toMatchObject({ inReplyTo: '1', uri: 'https://mastodon.example/users/a/statuses/10' });
    expect(r[0].post.paragraphs).toEqual(['reply 10']);
  });

  test("the ones Fedizen lacks fit in their place, read-only; Fedizen's own copy wins", () => {
    const focus = { id: 'F1', statusId: 'F1', url: 'https://mastodon.example/@a/1', uri: 'https://mastodon.example/users/a/statuses/1' } as FedizenPost;
    const onFedizen = { id: 'F2', statusId: 'F2', uri: 'https://mastodon.example/users/a/statuses/10', replyTo: { statusId: 'F1' }, author: 'Ann', handle: '@ann', paragraphs: ['reply 10'], url: '' } as FedizenPost;
    const replies = originReplies([status('10', '1'), status('11', '10'), status('12', '11'), status('13', '1')]);
    const extra = repliesFedizenLacks({ host: 'mastodon.example', id: '1' }, focus, [focus, onFedizen], replies);
    // #10 is on Fedizen already; #11 answers it (so hangs under Fedizen's F2), #12 answers #11, #13 the post itself.
    expect(extra.map(p => [p.id, p.replyTo?.statusId])).toEqual([
      ['origin:mastodon.example:11', 'F2'], ['origin:mastodon.example:12', 'origin:mastodon.example:11'], ['origin:mastodon.example:13', 'F1'],
    ]);
    for (const p of extra) {
      expect(p.statusId).toBeUndefined(); // nothing to like, boost or reply to on Fedizen
      expect(p.notOnFedizen).toEqual({ host: 'mastodon.example' });
    }
    const t = buildThread({ ...focus, author: 'A', handle: '@a', paragraphs: [] }, [], [onFedizen, ...extra]);
    expect(t.total).toBe(4);
  });

  test('added when the thread is built, never into what Fedizen sent (so a later read never tombstones them)', () => {
    const src = readFileSync('src/components/social/useThread.ts', 'utf8');
    expect(src).toMatch(/buildThread\(focus, current\?\.data\.ancestors \?\? \[\], \[\.\.\.\(current\?\.data\.descendants \?\? \[\]\), \.\.\.originExtra\]/);
    expect(src).toMatch(/enabled: !!origin && origin\.host !== 'fedizen\.net'/);
    const row = readFileSync('src/components/social/ConversationThread.tsx', 'utf8');
    expect(row).toMatch(/Not on Fedizen yet · <a href=\{p\.url\}/);
    expect(row).toMatch(/if \(hero \|\| p\.notOnFedizen\) return;/);
    // Read on the server through safeFetch only.
    expect(readFileSync('src/lib/origin-replies.functions.ts', 'utf8')).toMatch(/safeFetch\(`https:\/\/\$\{data\.host\}\/api\/v1\/statuses\/\$\{data\.id\}\/context`, 'application\/json'\)/);
  });
});
