import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { MAX_CHECKED_AUTHORS, authorsToCheck, originOf, originReplies, repliesFedizenLacks, visibleOriginReplies, type AuthorCheck } from '../src/lib/origin-replies';
import type { SpotlightModeration } from '../src/lib/spotlight-curation';
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
    const r = originReplies([status('10', '1'), status('11', '1', { visibility: 'private' }), status('12', '1', { visibility: 'direct' }), { id: 'x', visibility: 'public' }, null], 'mastodon.example');
    expect(r.map(x => x.id)).toEqual(['10']);
    expect(r[0]).toMatchObject({ inReplyTo: '1', uri: 'https://mastodon.example/users/a/statuses/10' });
    expect(r[0].post.paragraphs).toEqual(['reply 10']);
  });

  test("the ones Fedizen lacks fit in their place, read-only; Fedizen's own copy wins", () => {
    const focus = { id: 'F1', statusId: 'F1', url: 'https://mastodon.example/@a/1', uri: 'https://mastodon.example/users/a/statuses/1' } as FedizenPost;
    const onFedizen = { id: 'F2', statusId: 'F2', uri: 'https://mastodon.example/users/a/statuses/10', replyTo: { statusId: 'F1' }, author: 'Ann', handle: '@ann', paragraphs: ['reply 10'], url: '' } as FedizenPost;
    const replies = originReplies([status('10', '1'), status('11', '10'), status('12', '11'), status('13', '1')], 'mastodon.example');
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
    expect(src).toMatch(/enabled: !!id && !!origin && origin\.host !== 'fedizen\.net'/);
    expect(src).toMatch(/queryKey: \['origin-replies', id,/);
    const row = readFileSync('src/components/social/ConversationThread.tsx', 'utf8');
    expect(row).toMatch(/Not on Fedizen yet · <a href=\{p\.url\}/);
    expect(row).toMatch(/if \(hero \|\| p\.notOnFedizen\) return;/);
    // Read on the server through safeFetch only.
    expect(readFileSync('src/lib/origin-replies.functions.ts', 'utf8')).toMatch(/safeFetch\(`https:\/\/\$\{host\}\/api\/v1\/statuses\/\$\{id\}\/context`, 'application\/json'\)/);
  });

  test("that server's own people get its name, not Fedizen's (authors and mentions)", () => {
    const [r] = originReplies([status('10', '1', { account: { acct: 'bob', display_name: 'Bob' }, mentions: [{ acct: 'carol', username: 'carol', url: 'https://mastodon.example/@carol' }, { acct: 'dan@other.example', username: 'dan', url: 'https://other.example/@dan' }] })], 'mastodon.example');
    expect(r!.post.acct).toBe('bob@mastodon.example');
    expect((r!.post.mentions ?? []).map(m => m.acct)).toEqual(['carol@mastodon.example', 'dan@other.example']);
  });

  test('no poll: its id is the other server\'s, so a vote would go to the wrong post', () => {
    const replies = originReplies([status('10', '1', { poll: { id: '7', options: [{ title: 'a', votes_count: 1 }, { title: 'b', votes_count: 0 }], expired: false, multiple: false, votes_count: 1 } })], 'mastodon.example');
    const [p] = repliesFedizenLacks({ host: 'mastodon.example', id: '1' }, { id: 'F1', statusId: 'F1' }, [], replies);
    expect(p!.pollState).toBeUndefined();
  });

  describe("the reader's blocks and mutes", () => {
    const by = (id: string, acct: string) => status(id, '1', { account: { acct, display_name: acct } });
    const replies = originReplies([
      by('10', 'ann'), by('11', 'blocked@b.example'), by('12', 'muted@m.example'), by('13', 'rel@r.example'),
      by('14', 'new@quiet.example'), by('15', 'new@banned.example'), by('16', 'known@banned.example'), by('17', 'err@e.example'),
      by('18', 'x@sub.listed.example'),
    ], 'mastodon.example');
    const moderation: SpotlightModeration = { blockedHandles: ['Blocked@b.example'], mutedHandles: ['@muted@m.example'], blockedIds: [], mutedIds: [], domainCoverage: 'unavailable', blockedDomains: ['listed.example'] };
    const checks = new Map<string, AuthorCheck>([
      ['ann@mastodon.example', { state: 'known', blocking: false, muting: false }],
      ['blocked@b.example', { state: 'known' }], ['muted@m.example', { state: 'known' }],
      ['rel@r.example', { state: 'known', muting: true }],
      ['new@quiet.example', { state: 'unknown' }],
      ['new@banned.example', { state: 'unknown' }],
      ['known@banned.example', { state: 'known', domain_blocking: true }],
      ['err@e.example', { state: 'unreadable' }],
      ['x@sub.listed.example', { state: 'unknown' }],
    ]);
    test('blocked, muted, from a blocked server, or not checked: left out', () => {
      expect(visibleOriginReplies(replies, moderation, checks).map(r => r.id)).toEqual(['10', '14']);
    });
    test('an author with no check at all is left out', () => {
      expect(visibleOriginReplies(replies, moderation, new Map())).toEqual([]);
    });
    test('at most MAX_CHECKED_AUTHORS distinct authors are checked', () => {
      const many = originReplies(Array.from({ length: 60 }, (_, i) => by(String(100 + i), `p${i % 50}@x.example`)), 'mastodon.example');
      expect(authorsToCheck(many)).toHaveLength(MAX_CHECKED_AUTHORS);
    });
    test('the server function applies them, per reader, and shows nothing when moderation can\'t be read', () => {
      const fn = readFileSync('src/lib/origin-replies.functions.ts', 'utf8');
      expect(fn).toMatch(/middleware\(\[requireSupabaseAuth\]\)/);
      expect(fn).toMatch(/assertFedizenSessionIntent\(data\.expectedAtlasUserId, context\.userId\)/);
      expect(fn).toMatch(/if \(!moderation \|\| !looked\) return \{ replies: \[\] \};/);
      expect(fn).toMatch(/if \(r\?\.status !== 200\) return \{ replies: \[\] \};/);
      expect(fn).toMatch(/visibleOriginReplies\(replies, moderation, checks\)/);
    });
  });
});
