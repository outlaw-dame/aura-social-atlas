import { describe, expect, test } from 'bun:test';
import { fromBonfireSse, fromMastoFrame, readSse, toSse } from '../src/lib/live-events';

describe('Live updates from Fedizen', () => {
  test('Mastodon streaming frames become posts, deletes and notifications; the rest is dropped', () => {
    expect(fromMastoFrame(JSON.stringify({ stream: ['user'], event: 'update', payload: JSON.stringify({ id: '01A', content: '<p>hi</p>' }) }))).toEqual({ type: 'post', status: { id: '01A', content: '<p>hi</p>' } });
    expect(fromMastoFrame(JSON.stringify({ event: 'status.update', payload: JSON.stringify({ id: '01A' }) }))).toMatchObject({ type: 'post', edited: true });
    expect(fromMastoFrame(JSON.stringify({ event: 'delete', payload: '01A' }))).toEqual({ type: 'delete', id: '01A' });
    expect(fromMastoFrame(JSON.stringify({ event: 'delete', payload: '../x' }))).toBeNull();
    expect(fromMastoFrame(JSON.stringify({ event: 'notification', payload: JSON.stringify({ type: 'mention', access_token: 'nope' }) }))).toEqual({ type: 'notification', kind: 'mention' });
    expect(fromMastoFrame(JSON.stringify({ event: 'filters_changed' }))).toBeNull();
    expect(fromMastoFrame('not json')).toBeNull();
  });
  test('reads SSE across chunks, ignoring comments (heartbeats)', () => {
    const a = readSse('event: unseen_count\ndata: {"count":3}\n\n: heartbeat\n\nevent: notif');
    expect(a.events).toEqual([{ event: 'unseen_count', data: '{"count":3}' }]);
    const b = readSse(a.rest + 'ication\ndata: {"title":"x"}\n\n');
    expect(b.events).toEqual([{ event: 'notification', data: '{"title":"x"}' }]);
    expect(b.rest).toBe('');
  });
  test("Bonfire's SSE events carry only what Atlas acts on", () => {
    expect(fromBonfireSse({ event: 'notification', data: '{"title":"Ann liked","url":"https://fedizen.net/x"}' })).toEqual({ type: 'notification' });
    expect(fromBonfireSse({ event: 'unseen_count', data: '{"count":4}' })).toEqual({ type: 'unseen', count: 4 });
    expect(fromBonfireSse({ event: 'unseen_count', data: '{"count":-1}' })).toBeNull();
    expect(fromBonfireSse({ event: 'message', data: '{}' })).toEqual({ type: 'message' });
    expect(toSse({ type: 'unseen', count: 2 })).toBe('event: unseen\ndata: {"type":"unseen","count":2}\n\n');
  });
});
