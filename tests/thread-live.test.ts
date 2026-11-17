import { describe, test } from 'node:test';
import { deepStrictEqual, ok, strictEqual } from 'node:assert';
import { reconcile, touches, withDeleted, type ThreadData } from '../src/lib/thread-live';
import type { FedizenPost } from '../src/lib/fedizen-feed';

let n = 0;
const post = (id: string, who: string, parent?: string, extra: Partial<FedizenPost> = {}): FedizenPost => ({
  id, statusId: id, author: who, handle: `@${who}@x.example`, paragraphs: [id], url: `https://x.example/${id}`,
  date: new Date(Date.UTC(2026, 0, 1, 0, 0, n++)).toISOString(), ...(parent ? { replyTo: { statusId: parent } } : {}), ...extra,
});
const ids = (ps: FedizenPost[]) => ps.map(p => p.statusId);
const none = new Set<string>();
const opts = (o: Partial<Parameters<typeof reconcile>[2]> = {}) => ({ deleted: none, complete: true, ...o });

describe('a conversation kept up to date while open', () => {
  n = 0;
  const f = post('f', 'ann'), a = post('a', 'bob', 'f'), b = post('b', 'cat', 'a');
  const shown: ThreadData = { post: f, ancestors: [], descendants: [a, b] };

  test('new replies are added straight away, and listed as added', () => {
    const c = post('c', 'dan', 'f'), m = post('m', 'me', 'b');
    const r = reconcile(shown, { post: f, ancestors: [], descendants: [a, b, m, c] }, opts());
    deepStrictEqual(ids(r.shown.descendants), ['a', 'b', 'm', 'c']);
    deepStrictEqual(ids(r.added), ['c', 'm']); // oldest first
    strictEqual(reconcile(r.shown, { post: f, ancestors: [], descendants: [a, b, m, c] }, opts()).added.length, 0);
  });

  test('edits show in place', () => {
    const edited = { ...a, paragraphs: ['changed'], editedAt: '2026-01-02T00:00:00Z' };
    const r = reconcile(shown, { post: f, ancestors: [], descendants: [edited, b] }, opts());
    deepStrictEqual(r.shown.descendants[0].paragraphs, ['changed']);
  });

  test('a post gone from a whole read becomes a placeholder its replies still hang from; a partial read changes nothing', () => {
    const r = reconcile(shown, { post: f, ancestors: [], descendants: [b] }, opts());
    strictEqual(r.shown.descendants[0].tombstone, true);
    deepStrictEqual(r.shown.descendants[0].paragraphs, []);
    strictEqual(r.shown.descendants[0].replyTo?.statusId, 'f');
    strictEqual(r.shown.descendants[1].statusId, 'b');
    const partial = reconcile(shown, { post: f, ancestors: [], descendants: [] }, opts({ complete: false }));
    ok(!partial.shown.descendants.some(p => p.tombstone));
  });

  test('a deletion seen live applies at once, and a deleted post never comes back as new', () => {
    strictEqual(withDeleted(shown, 'b').descendants[1].tombstone, true);
    const c = post('c', 'dan', 'f');
    const r = reconcile(shown, { post: f, ancestors: [], descendants: [a, b, c] }, opts({ deleted: new Set(['c', 'a']) }));
    strictEqual(r.added.length, 0);
    strictEqual(r.shown.descendants[0].tombstone, true);
  });

  test('live posts that belong: one of its posts, or a reply to one', () => {
    ok(touches(shown, post('x', 'eve', 'b')));
    ok(touches(shown, { ...a }));
    ok(!touches(shown, post('y', 'eve', 'elsewhere')));
  });
});
