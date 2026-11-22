import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { auditPrivateReads, type PrivateReadCheck } from '../src/lib/staging-private-read-audit';

const requests = (answer: () => Promise<unknown>): PrivateReadCheck[] =>
  ['Fedizen connection', 'Following / Home', 'Home refresh', 'Direct conversations',
    'Activity / notifications', 'Notification marker', 'Saved posts', 'Circles']
    .map(label => ({ label, run: answer }));

describe('staging-only explicit owner private reads', () => {
  test('eight authenticated functions are observed, and no data payload survives the result', async () => {
    const all = requests(async () => ({ groups: [], connected: true, privateContent: 'never-display' }));
    all[1] = { label: 'Following / Home', run: async () => ({
      connected: true, posts: [
        { visibility: 'public', content: 'public-data' },
        { visibility: 'private', content: 'private-content' },
        { visibility: 'direct', content: 'private-dm' },
        { content: 'unknown-visibility' },
      ],
    }) };
    const out = await auditPrivateReads(all);
    expect(out.outcome).toBe('complete');
    expect(out.checks).toHaveLength(8);
    expect(out.homeSampleCount).toBe(4);
    expect(out.nonPublicHomeCount).toBe(2);
    for (const text of ['never-display', 'private-content', 'private-dm']) {
      expect(JSON.stringify(out)).not.toContain(text);
    }
  });

  test('no nonpublic post in the first page does not forge an A/B privacy conclusion', async () => {
    const all = requests(async () => ({ connected: true }));
    all[1] = { label: 'Following / Home', run: async () => ({
      connected: true, posts: [{ visibility: 'public' }, { visibility: 'unlisted' }],
    }) };
    const out = await auditPrivateReads(all);
    expect(out.outcome).toBe('complete');
    expect(out.nonPublicHomeCount).toBe(0);
    expect(out.homeSampleCount).toBe(2);
    expect(JSON.stringify(out)).not.toContain('denied');
  });

  test('without an owner connection, a no-data response is inconclusive', async () => {
    const out = await auditPrivateReads(requests(async () => ({ connected: false, posts: [] })));
    expect(out.outcome).toBe('incomplete');
    expect(out.checks.some(x => x.result === 'inconclusive')).toBe(true);
  });

  test('network exceptions and reported upstream failures never pass', async () => {
    const all = requests(async () => ({ connected: true, posts: [] }));
    all[3] = { label: 'Direct conversations', run: async () => { throw new Error('secret-token-during-network-error'); } };
    const out = await auditPrivateReads(all);
    expect(out.outcome).toBe('incomplete');
    expect(out.checks[3].result).toBe('inconclusive');
    expect(JSON.stringify(out)).not.toContain('secret-token');
    const errored = requests(async () => ({ error: 'unavailable' }));
    expect((await auditPrivateReads(errored)).outcome).toBe('incomplete');
  });

  test('missing or duplicate read cannot claim complete', async () => {
    const all = requests(async () => ({ connected: true, posts: [] }));
    expect((await auditPrivateReads(all.slice(0, 7))).outcome).toBe('incomplete');
    all[7] = { ...all[0] };
    expect((await auditPrivateReads(all)).outcome).toBe('incomplete');
  });

  test('the public result explicitly excludes raw payloads and account selectors', () => {
    const route = readFileSync('src/routes/fedizen-acceptance.tsx', 'utf8');
    expect(route).toContain('Test my eight protected reads');
    expect(route).toContain('Private/direct visibility markers found');
    expect(route).toContain('different Fedizen account');
    expect(route).not.toContain('console.log(jwt)');
    const source = readFileSync('src/lib/staging-private-read-audit.ts', 'utf8');
    expect(source).not.toContain('JSON.stringify(result)');
  });
});
