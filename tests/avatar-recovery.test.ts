import { describe, expect, test } from 'bun:test';
import { fromAccounts, isPlaceholderAvatar } from '../src/lib/fedizen-feed';

describe('account lists (follow requests, circles, search)', () => {
  test("Fedizen's stand-in picture is not passed off as the person's avatar", () => {
    const [a, b] = fromAccounts([
      { id: '1', acct: 'x@lemmy.world', avatar: 'https://fedizen.net/images/avatar.png' },
      { id: '2', acct: 'y@mastodon.social', avatar: 'https://files.mastodon.social/a.png' },
    ] as never);
    expect(isPlaceholderAvatar('https://fedizen.net/images/avatar.png')).toBe(true);
    expect(a.avatar).toBeUndefined();
    expect(b.avatar).toBe('https://files.mastodon.social/a.png');
  });
});
