import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { CONTEXT_REPLY_LIMIT } from '../src/lib/thread-limits';

describe('a conversation Fedizen cut short says so', () => {
  test("Fedizen's context sends at most 80 replies (bonfire_social descendant_reply_ids, d64795d)", () => {
    expect(CONTEXT_REPLY_LIMIT).toBe(80);
  });
  test('the server flags a reply list that reached the limit, and both conversation views pass it on', () => {
    expect(readFileSync('src/lib/fedizen.functions.ts', 'utf8')).toContain('raw.descendants.length >= CONTEXT_REPLY_LIMIT');
    for (const f of ['src/components/social/ThreadView.tsx', 'src/components/f7/Thread.tsx'])
      expect(readFileSync(f, 'utf8')).toContain('capped={t.capped}');
    const view = readFileSync('src/components/social/ConversationThread.tsx', 'utf8');
    expect(view).toContain('props.capped && !loading');
    // The link goes to the post's own page, opened apart from Atlas.
    expect(view).toContain('href={t.focus.url} target="_blank" rel="noopener noreferrer"');
  });
});
