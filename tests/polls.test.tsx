import { describe, expect, test } from 'bun:test';
import { pollOf } from '../src/lib/fedizen-feed';
import { pollShares, pollTime } from '../src/components/social/PollView';

const raw = { id: '01Q', expires_at: '2026-11-17T12:00:00Z', expired: false, multiple: false, votes_count: 4, voters_count: 4, voted: false, own_votes: [], options: [{ title: 'Yes', votes_count: 3 }, { title: 'No', votes_count: 1 }] };

describe('Polls', () => {
  test('a Mastodon poll as Atlas shows it', () => {
    expect(pollOf(raw)).toMatchObject({ id: '01Q', multiple: false, expired: false, votes: 4, voted: false, options: [{ title: 'Yes', votes: 3 }, { title: 'No', votes: 1 }] });
    expect(pollOf({ ...raw, id: '../x' })).toBeNull();
    expect(pollOf({ ...raw, options: [{ title: 'only' }] })).toBeNull();
  });
  test('shares are of votes, or of voters when several choices are allowed (as Mastodon counts them)', () => {
    expect(pollShares(pollOf(raw)!)).toEqual([75, 25]);
    expect(pollShares(pollOf({ ...raw, multiple: true, voters_count: 3, votes_count: 5, options: [{ title: 'a', votes_count: 3 }, { title: 'b', votes_count: 2 }] })!)).toEqual([100, 67]);
  });
  test('time left, and closed', () => {
    const p = pollOf(raw)!;
    expect(pollTime(p, Date.parse('2026-11-17T09:00:00Z'))).toContain('3');
    expect(pollTime(p, Date.parse('2026-11-17T13:00:00Z'))).toBe('Closed');
    expect(pollTime({ ...p, expired: true })).toBe('Closed');
  });
});
