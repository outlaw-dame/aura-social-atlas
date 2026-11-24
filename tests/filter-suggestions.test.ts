import { afterEach, describe, expect, test } from 'bun:test';
import { suggestFilters } from '../src/lib/intelligence/tasks';
import type { ContentFilter } from '../src/lib/content-filter';

// Invented filters and model replies; fetch is stubbed, nothing is sent.
const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });
const filter = (id: string, text: string): ContentFilter => ({ id, text, kind: 'word', action: 'hide', semantic: true, expansions: [], places: ['home', 'public', 'account'], expiresAt: null, exceptFollowing: false });
const filters = [filter('11111111-1111-4111-8111-111111111111', 'fur*'), filter('22222222-2222-4222-8222-222222222222', 'nft')];
let sent: Record<string, unknown> | null = null;
const reply = (content: unknown) => { globalThis.fetch = (async (_u: string, init: RequestInit) => { sent = JSON.parse(String(init.body)); return new Response(JSON.stringify({ choices: [{ message: { content }, finish_reason: 'stop' }] }), { status: 200 }); }) as unknown as typeof fetch; };
const body = { suggestions: [{ filter: 'furry fandom', reason: 'The subject your fur* filter aims at.' }], cautions: [
  { id: filters[0].id, issue: 'Also hides ordinary posts about pets.', replacement: 'furry fandom' },
  { id: filters[1].id, issue: 'Fine as it is.', replacement: 'NFT' },
  { id: 'not-a-filter', issue: 'x', replacement: 'y' },
] };

describe('Suggest filters', () => {
  test('a caution carries the words to change the filter to, unless they are the same words', async () => {
    reply(JSON.stringify(body));
    const r = await suggestFilters({ provider: 'google', key: 'invented-key' }, 'gemini-4-hydrogen', filters);
    expect(r.cautions).toEqual([
      { filterId: filters[0].id, issue: 'Also hides ordinary posts about pets.', replacement: 'furry fandom' },
      { filterId: filters[1].id, issue: 'Fine as it is.' },
    ]);
  });
  test('reads a reply sent as parts, or wrapped in an array', async () => {
    reply([{ type: 'text', text: JSON.stringify([body]) }]);
    const r = await suggestFilters({ provider: 'google', key: 'invented-key' }, 'gemini-4-hydrogen', filters);
    expect(r.suggestions).toEqual([{ text: 'furry fandom', reason: 'The subject your fur* filter aims at.' }]);
  });
  test('thinking models get room to reason on top of the answer', async () => {
    reply(JSON.stringify(body));
    await suggestFilters({ provider: 'google', key: 'invented-key' }, 'gemini-4-hydrogen', filters);
    expect((sent as { max_tokens?: number }).max_tokens).toBeGreaterThan(3000 + 10_000);
  });
  test('accounts only from those the person\'s moderation noticed, never already blocked or muted', async () => {
    reply(JSON.stringify({ ...body, accounts: [
      { acct: '@Noticed@spam.example', action: 'mute', reason: 'Five posts hidden by your crypto filters.' },
      { acct: 'invented@elsewhere.example', action: 'block', reason: 'Made up.' },
      { acct: 'blocked@spam.example', action: 'block', reason: 'Already blocked.' },
    ] }));
    const r = await suggestFilters({ provider: 'google', key: 'invented-key' }, 'gemini-4-hydrogen', filters, {
      blocked: ['blocked@spam.example'], muted: [],
      noticed: [
        { acct: 'noticed@spam.example', caught: 5, filters: [filters[1].id], boostsBlocked: 0, repliesBlocked: 0, reported: false },
        { acct: 'blocked@spam.example', caught: 3, filters: [], boostsBlocked: 0, repliesBlocked: 0, reported: false },
      ],
    });
    expect(r.accounts).toEqual([{ acct: 'noticed@spam.example', action: 'mute', reason: 'Five posts hidden by your crypto filters.' }]);
    const input = JSON.parse((sent as { messages: { content: string }[] }).messages[1].content);
    expect(input.noticed_accounts[0]).toMatchObject({ acct: 'noticed@spam.example', posts_your_filters_caught: 5, caught_by: ['nft'] });
  });
});
