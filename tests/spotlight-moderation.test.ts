import { describe, expect, it } from 'bun:test';
import { allowedSpotlightItem, normalizedAccount, selectModeratedSpotlight, spotlightFilterPost, spotlightInitialLoading, verifiedBonfireArticleSource, type SpotlightModeration } from '../src/lib/spotlight-curation';
import { readSpotlightModeration } from '../src/lib/spotlight-moderation.server';
import { fromFederatedLinkCards, fromFederatedVideos, type SpotlightItem } from '../src/lib/spotlight';
import { FilterEngine } from '../src/lib/filter-engine';
import type { ContentFilter } from '../src/lib/content-filter';

const empty: SpotlightModeration = {
  blockedHandles: [], mutedHandles: [], blockedIds: [], mutedIds: [],
  domainCoverage: 'unavailable', blockedDomains: [],
};
const card = (sources: SpotlightItem['sourceAccounts'], extras: Partial<SpotlightItem> = {}): SpotlightItem => ({
  id: 'source-card', source: 'Bonfire', title: 'Public article', description: 'Public summary',
  url: 'https://fedizen.net/article', provider: 'fedizen.net', kind: 'article',
  reason: 'recent',
  sourceAccounts: sources?.map(source => {
    const acct = source.handle.replace(/^@/, '').split('@');
    const host = acct.length === 2 ? acct[1] : 'fedizen.net';
    return { ...source, actorUrl: source.actorUrl ?? `https://${host}/@test` };
  }), ...extras,
});

describe('personal Spotlight identity and moderation gate', () => {
  it('never equates unknown contributors with a safe account', () => {
    expect(allowedSpotlightItem(card(undefined), empty)).toBe(false);
    expect(allowedSpotlightItem(card([{ handle: 'not-an-account@@@' }]), empty)).toBe(false);
  });

  it('suppresses a blocked or muted source even when a different sharer is allowed', () => {
    const c = card([{ id: 'one', handle: 'good@fedizen.net' }, { id: 'two', handle: 'bad@fedizen.net' }]);
    expect(allowedSpotlightItem(c, { ...empty, blockedHandles: ['@bad@fedizen.net'] })).toBe(false);
    expect(allowedSpotlightItem(c, { ...empty, mutedIds: ['two'] })).toBe(false);
    expect(allowedSpotlightItem(c, empty)).toBe(true);
  });

  it('fails closed for remote actors until Fedizen makes domain blocks available', () => {
    const remote = card([{ handle: 'remote@example.org' }]);
    expect(allowedSpotlightItem(remote, empty)).toBe(false);
    expect(allowedSpotlightItem(remote, { ...empty, domainCoverage: 'complete', blockedDomains: [] })).toBe(true);
    expect(allowedSpotlightItem(remote, { ...empty, domainCoverage: 'complete', blockedDomains: ['example.org'] })).toBe(false);
    expect(allowedSpotlightItem(card([{ handle: 'remote@a.example.org' }]), { ...empty, domainCoverage: 'complete', blockedDomains: ['example.org'] })).toBe(false);
    expect(normalizedAccount('@foo')).toBe('foo@fedizen.net');
    expect(normalizedAccount('@foo@fake.org@another.org')).toBeNull();
  });

  it('rejects accounts whose short Fedizen handle disagrees with the actor origin', () => {
    expect(allowedSpotlightItem(card([{ handle: 'alice', actorUrl: 'https://remote.example/users/alice' }]), empty)).toBe(false);
    expect(allowedSpotlightItem(card([{ handle: 'alice', actorUrl: 'http://fedizen.net/@alice' }]), empty)).toBe(false);
    expect(allowedSpotlightItem(card([{ handle: 'alice', actorUrl: 'https://fedizen.net:444/@alice' }]), empty)).toBe(false);
    expect(allowedSpotlightItem(card([{ handle: 'alice', actorUrl: 'https://fedizen.net/@alice' }]), empty)).toBe(true);
  });

  it('does not treat publisher identity as an excuse to bypass an author block', () => {
    expect(allowedSpotlightItem(card([{ handle: 'good@fedizen.net' }], {
      authorAccount: { acct: '@blocked@fedizen.net', name: 'Blocked', url: 'https://fedizen.net/@blocked', verifiedBy: 'fedizen' },
    }), { ...empty, blockedHandles: ['blocked'] })).toBe(false);
  });

  it('requires a complete source ledger, even if later contributors are allowed', () => {
    expect(allowedSpotlightItem(card([{ handle: 'fine@fedizen.net' }], { sourceComplete: false }), empty)).toBe(false);
    const preview = {
      url: 'https://example.org/a', title: 'Substantial public report',
      description: 'Long enough description to represent the link preview for filtering.',
      image: 'https://example.org/p.jpg',
    };
    const statuses = [
      { id: 'a', visibility: 'public', account: { acct: null }, card: preview, reblogs_count: 3 },
      { id: 'b', visibility: 'public', account: { id: 'b', acct: 'known', url: 'https://fedizen.net/@known' }, card: preview, reblogs_count: 3 },
    ];
    const links = fromFederatedLinkCards(statuses);
    expect(links).toHaveLength(1);
    expect(links[0].sourceComplete).toBe(false);
    expect(allowedSpotlightItem(links[0], empty)).toBe(false);
  });

  it('suppresses reply-based Spotlight cards when the parent author cannot be checked', () => {
    const reply = {
      id: 'reply', visibility: 'public', in_reply_to_id: 'unknown-parent',
      account: { id: 'a', acct: 'allowed', url: 'https://fedizen.net/@allowed' },
      url: 'https://fedizen.net/posts/reply', content: 'I am replying to a blocked author',
      media_attachments: [{ type: 'video', url: 'https://media.example.org/a.mp4' }],
      card: { url: 'https://example.org/article', title: 'A substantial source report',
        description: 'A description long enough to qualify as a good public card.',
        image: 'https://example.org/preview.jpg' },
      reblogs_count: 5,
    };
    expect(fromFederatedVideos([reply])).toEqual([]);
    expect(fromFederatedLinkCards([reply])).toEqual([]);
  });

  it('does not promote quote previews whose secondary author cannot be evaluated', () => {
    const status = {
      id: 'quote', visibility: 'public',
      account: { id: 'a', acct: 'allowed', url: 'https://fedizen.net/@allowed' },
      url: 'https://fedizen.net/posts/quote',
      quote: { quoted_status: { content: 'Text by a blocked account' } },
      content: 'Quoted a blocked person', media_attachments: [{ type: 'video', url: 'https://media.example.org/a.mp4' }],
      card: { url: 'https://example.org/article', title: 'A fully qualifying example story',
        description: 'A fully qualifying example description for a linked article.',
        image: 'https://example.org/preview.jpg' },
      reblogs_count: 5,
    };
    expect(fromFederatedVideos([status])).toEqual([]);
    expect(fromFederatedLinkCards([status])).toEqual([]);
  });

  it('does not promote private posts even with a valid source-account handle', () => {
    expect(fromFederatedVideos([{ id: 'x', visibility: 'private', url: 'https://fedizen.net/p/x', account: { acct: 'good' }, media_attachments: [{ type: 'video', url: 'https://cdn.example.org/v.mp4' }] }])).toEqual([]);
  });
});

describe('complete, failure-closed moderation list reads', () => {
  it('combines complete blocks and mutes without assuming a missing list is empty', async () => {
    const moderation = await readSpotlightModeration(async (path) => ({
      status: 200, data: path.includes('blocks')
        ? [{ id: 'x', acct: 'blocked@fedizen.net' }]
        : [{ id: 'y', acct: 'muted@elsewhere.example' }],
    }));
    expect(moderation).toMatchObject({
      blockedHandles: ['blocked@fedizen.net'], blockedIds: ['x'],
      mutedHandles: ['muted@elsewhere.example'], mutedIds: ['y'],
      domainCoverage: 'unavailable',
    });
  });
  it('rejects 401/502, unknown identity, pagination and transport failures', async () => {
    expect(await readSpotlightModeration(async () => ({ status: 401, data: [] }))).toBeNull();
    expect(await readSpotlightModeration(async () => ({ status: 200, data: [{ id: 'x' }] }))).toBeNull();
    expect(await readSpotlightModeration(async () => ({ status: 200, data: [], next: 'cursor' }))).toBeNull();
    expect(await readSpotlightModeration(async () => { throw new Error('down'); })).toBeNull();
  });
});

describe('paginated owner moderation completeness', () => {
  it('accepts an unpaginated large Bonfire account list without discarding owner policy', async () => {
    const large = Array.from({ length: 2319 }, (_, i) => ({
      id: `block-${i}`, acct: `blocked${i}@fedizen.net`,
    }));
    const snapshot = await readSpotlightModeration(async path => ({
      status: 200, data: path.includes('/blocks?') ? large : [],
    }));
    expect(snapshot?.blockedIds).toHaveLength(2319);
    expect(allowedSpotlightItem(card([{ id: 'block-2318', handle: 'blocked2318' }]), snapshot!)).toBe(false);
    expect(allowedSpotlightItem(card([{ handle: 'safe' }]), snapshot!)).toBe(true);
  });

  it('combines every page before approving the owner snapshot', async () => {
    const requested: string[] = [];
    const snapshot = await readSpotlightModeration(async path => {
      requested.push(path);
      if (path.startsWith('/api/v1/mutes?')) return { status: 200, data: [] };
      const page = path.includes('max_id=') ? 1 : 0;
      return {
        status: 200,
        data: Array.from({ length: 80 }, (_, i) => ({
          id: `b-${page * 80 + i}`,
          acct: `blocked${page * 80 + i}@fedizen.net`,
        })),
        ...(page === 0 ? { next: 'older-1' } : {}),
      };
    });
    expect(snapshot?.blockedIds).toHaveLength(160);
    expect(requested).toContain('/api/v1/blocks?limit=80&max_id=older-1');
    expect(allowedSpotlightItem(card([{ id: 'b-159', handle: 'blocked159' }]), snapshot!)).toBe(false);
  });

  it('never declares a partial or untrusted page chain complete', async () => {
    const first = [{ id: 'a', acct: 'a@fedizen.net' }];
    const one = (next: string) => readSpotlightModeration(async path => ({
      status: 200, data: first, ...(path.startsWith('/api/v1/blocks?') ? { next } : {}),
    }));
    expect(await one('https://evil.example/private')).toBeNull();
    expect(await one('duplicate')).toBeNull();
    expect(await readSpotlightModeration(async path => ({
      status: path.includes('max_id=') ? 429 : 200,
      data: first, ...(path === '/api/v1/blocks?limit=80' ? { next: 'older' } : {}),
    }))).toBeNull();
    expect(await readSpotlightModeration(async path => ({
      status: 200, data: path.includes('max_id=') ? [{ id: 'x' }] : first,
      ...(path === '/api/v1/blocks?limit=80' ? { next: 'older' } : {}),
    }))).toBeNull();
  });
});

const rule = (opts: Partial<ContentFilter> = {}): ContentFilter => ({
  id: 'rule', text: 'spoiler', kind: 'word', action: 'hide', semantic: false,
  expansions: [], places: ['public'], expiresAt: null, exceptFollowing: false,
  ...opts,
});

describe('shared Atlas filter engine in Spotlight mode', () => {
  it('applies the same lexical terms to titles, descriptions and linked post text', () => {
    const p = spotlightFilterPost(card([{ handle: 'good' }], { title: 'A spoiler', filterText: 'quoted discussion' }));
    const engine = new FilterEngine();
    const rules = [rule()];
    engine.configure({ filters: rules, ai: false, deep: false });
    expect(engine.hasCurrentFilters(rules)).toBe(true);
    expect(engine.discoveryClear(p, 'public')).toBe(false);
    expect(engine.discoveryClear(spotlightFilterPost(card([{ handle: 'good' }], { title: 'Other', description: 'Unrelated' })), 'public')).toBe(true);
  });
  it('hides ALL discovery candidates if a semantic rule cannot be evaluated', () => {
    const p = spotlightFilterPost(card([{ handle: 'good' }], { title: 'Another topic' }));
    const engine = new FilterEngine();
    engine.configure({ filters: [rule({ semantic: true, kind: 'topic', text: 'unwanted subject' })], ai: false, deep: true });
    expect(engine.discoveryClear(p)).toBe(false);
  });
  it('does not render semantic candidates before asynchronous matching finishes', () => {
    const engine = new FilterEngine();
    engine.configure({
      filters: [rule({ semantic: true })], ai: false, deep: false,
      similar: async () => [{ n: 0, matches: [] }],
    });
    const p = spotlightFilterPost(card([{ handle: 'good' }], { title: 'Other' }));
    expect(engine.discoveryClear(p)).toBe(false);
    engine.request(p, 'public');
    expect(engine.discoveryClear(p)).toBe(false);
  });
});

describe('Spotlight authorization before same-URL selection', () => {
  it('keeps an eligible recent story when an unverified trend has the same URL', () => {
    const trend = card([], { id: 'unverified-trend', reason: 'trending' });
    const safe = card([{ handle: 'allowed' }], { id: 'recent-safe', reason: 'recent' });
    expect(selectModeratedSpotlight([trend], [safe], empty).map(x => x.id)).toEqual(['recent-safe']);
  });

  it('rejects blocked trending source, retains safe native article at same URL', () => {
    const blocked = card([{ handle: 'blocked' }], { id: 'blocked-trend', reason: 'trending' });
    const safe = card([{ handle: 'good' }], { id: 'safe', reason: 'recent' });
    expect(selectModeratedSpotlight([blocked, safe], [], { ...empty, blockedHandles: ['blocked'] }).map(x => x.id))
      .toEqual(['safe']);
  });

  it('keeps allowed trending priority while rejecting muted sources', () => {
    const trend = card([{ handle: 'good' }], { id: 'valid-trend', reason: 'trending' });
    const recent = card([{ handle: 'good' }], { id: 'valid-recent', reason: 'recent' });
    const muted = card([{ handle: 'muted' }], { id: 'muted', url: 'https://fedizen.net/other' });
    expect(selectModeratedSpotlight([trend, muted], [recent], { ...empty, mutedHandles: ['muted'] }).map(x => x.id))
      .toEqual(['valid-trend']);
  });
});

describe('filter engine refresh safety', () => {
  it('keeps an equivalent refreshed filter snapshot usable without resetting rules', () => {
    const engine = new FilterEngine();
    const original = [rule({ text: 'spoiler', semantic: false })];
    engine.configure({ filters: original, ai: false, deep: false });
    const post = spotlightFilterPost(card([{ handle: 'good' }], { title: 'Includes spoiler' }));
    expect(engine.discoveryClear(post)).toBe(false);
    const refreshed = original.map(x => ({ ...x, places: [...x.places], expansions: [...x.expansions] }));
    const before = engine.getRevision();
    engine.configure({ filters: refreshed, ai: false, deep: false });
    expect(engine.getRevision()).toBeGreaterThan(before);
    expect(engine.hasCurrentFilters(refreshed)).toBe(true);
    expect(engine.discoveryClear(post)).toBe(false);
  });
});

describe('semantic discovery reconfiguration while a previous batch is in flight', () => {
  it('restarts queued work for the new filter version without adopting stale results', async () => {
    const engine = new FilterEngine();
    const oldRule = rule({ id: 'old', text: 'old unsafe topic', semantic: true, kind: 'topic' });
    const newRule = rule({ id: 'new', text: 'new unsafe topic', semantic: true, kind: 'topic' });
    const oldPost = spotlightFilterPost(card([{ handle: 'good' }], { id: 'old-post', title: 'Public story from previous policy' }));
    const newPost = spotlightFilterPost(card([{ handle: 'good' }], { id: 'new-post', title: 'Public story with new policy' }));
    let startedOld!: () => void;
    const oldStarted = new Promise<void>(resolve => { startedOld = resolve; });
    let completeOld!: () => void;
    const oldFinish = new Promise<{ n: number; matches: { id: string; strong: boolean }[] }[]>(resolve => {
      completeOld = () => resolve([{ n: 0, matches: [{ id: 'old', strong: true }] }]);
    });
    engine.configure({ filters: [oldRule], ai: false, deep: false, scope: 'old-provider', similar: async () => {
      startedOld();
      return oldFinish;
    } });
    engine.request(oldPost, 'public');
    await Promise.race([
      oldStarted,
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Old semantic batch never started')), 2500)),
    ]);

    let startedNew!: () => void;
    const newStarted = new Promise<void>(resolve => { startedNew = resolve; });
    engine.configure({ filters: [newRule], ai: false, deep: false, scope: 'new-provider', similar: async () => {
      startedNew();
      return [{ n: 0, matches: [] }];
    } });
    engine.request(newPost, 'public');
    expect(engine.discoveryClear(newPost, 'public')).toBe(false);
    completeOld(); // stale, incompatible result must not be used under the new rules

    await Promise.race([
      newStarted,
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('New semantic queue was abandoned')), 2500)),
    ]);
    // The pending result is processed and the new post becomes eligible.
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(engine.discoveryClear(newPost, 'public')).toBe(true);
  });
});

describe('strict discovery diagnostics never weaken moderation', () => {
  it('distinguishes no configured semantic model from a pending check', () => {
    const engine = new FilterEngine();
    const post = spotlightFilterPost(card([{ handle: 'good' }], { title: 'Topic not yet checked' }));
    engine.configure({ filters: [rule({ semantic: true, kind: 'topic', text: 'danger' })], ai: false, deep: false });
    expect(engine.discoveryState(post)).toBe('unavailable');
    expect(engine.discoveryClear(post)).toBe(false);
  });

  it('reports semantic provider failure, not endless checking or allowed content', async () => {
    const engine = new FilterEngine();
    const post = spotlightFilterPost(card([{ handle: 'good' }], { title: 'Semantically unclassified story' }));
    let complete!: () => void;
    const called = new Promise<void>(resolve => { complete = resolve; });
    engine.configure({ filters: [rule({ semantic: true })], ai: false, deep: false, similar: async () => {
      complete();
      return null; // rate limit, provider outage, or malformed response
    } });
    engine.request(post, 'public');
    expect(engine.discoveryState(post)).toBe('pending');
    await Promise.race([
      called,
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('No semantic request')), 2500)),
    ]);
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(engine.discoveryState(post)).toBe('unavailable');
    expect(engine.discoveryClear(post)).toBe(false);
  });

  it('still distinguishes filtered lexical stories from pending relationship exceptions', () => {
    const engine = new FilterEngine();
    const flagged = spotlightFilterPost(card([{ handle: 'good' }], { title: 'Contains spoiler material' }));
    const safe = spotlightFilterPost(card([{ handle: 'good' }], { title: 'Ordinary public news' }));
    engine.configure({ filters: [rule()], ai: false, deep: false });
    expect(engine.discoveryState(flagged)).toBe('filtered');
    expect(engine.discoveryState(safe)).toBe('clear');
  });
});

describe('Bonfire Article candidate provenance and owner moderation', () => {
  it('verifies local and explicitly remote Article actors without treating bare names as remote proof', () => {
    const source = (handle: string, authorUrl: string) => {
      const article = { handle, authorUrl };
      const byline = { acct: handle.includes('@') ? `@${handle.replace(/^@/, '')}` : `@${handle}@fedizen.net`,
        name: 'Writer', url: authorUrl, verifiedBy: 'fedizen' as const };
      return verifiedBonfireArticleSource(article, byline);
    };
    expect(source('local', 'https://fedizen.net/users/local')).toMatchObject({
      sourceComplete: true, sourceAccounts: [{ handle: 'local@fedizen.net' }],
    });
    const remote = source('writer@remote.example', 'https://remote.example/users/writer');
    expect(remote.sourceComplete).toBe(true);
    expect(allowedSpotlightItem(card(remote.sourceAccounts as SpotlightItem['sourceAccounts'], remote), empty)).toBe(false);
    expect(allowedSpotlightItem(card(remote.sourceAccounts as SpotlightItem['sourceAccounts'], remote), {
      ...empty, domainCoverage: 'complete', blockedDomains: [],
    })).toBe(true);
    expect(source('writer', 'https://remote.example/users/writer').sourceComplete).toBe(false);
    expect(source('writer@remote.example', 'https://impostor.example/users/writer').sourceComplete).toBe(false);
    expect(source('writer@remote.example', 'http://remote.example/users/writer').sourceComplete).toBe(false);
    expect(source('writer@remote.example', 'https://remote.example:444/users/writer').sourceComplete).toBe(false);
  });

  it('retains an eligible local article deeper than the first six untrusted results', () => {
    const remote = card([{ handle: 'remote@remote.example' }], { sourceComplete: true });
    const local = card([{ handle: 'good' }], { id: 'local-later', url: 'https://example.org/unique-later-article' });
    const records = Array.from({ length: 7 }, (_, n) => ({ ...remote, id: `remote-${n}`, url: `https://example.org/remote-${n}` })).concat(local);
    expect(selectModeratedSpotlight(records, [], empty).map(x => x.id)).toEqual(['local-later']);
  });
});

describe('Spotlight loading honors independent source readiness', () => {
  const base = { signedIn: true, hasItems: false, moderationUnavailable: false };
  it('never requires the optional trending request to finish', () => {
    expect(spotlightInitialLoading({ ...base, viewerPending: false, articlesPending: false })).toBe(false);
  });
  it('still waits for a required owner policy or its initial public Article source', () => {
    expect(spotlightInitialLoading({ ...base, viewerPending: true, articlesPending: false })).toBe(true);
    expect(spotlightInitialLoading({ ...base, viewerPending: false, articlesPending: true })).toBe(true);
  });
  it('shows cleared articles immediately and reports missing moderation, not perpetual loading', () => {
    expect(spotlightInitialLoading({ ...base, hasItems: true, viewerPending: true, articlesPending: true })).toBe(false);
    expect(spotlightInitialLoading({ ...base, moderationUnavailable: true, viewerPending: false, articlesPending: true })).toBe(false);
    expect(spotlightInitialLoading({ ...base, signedIn: false, viewerPending: true, articlesPending: true })).toBe(false);
  });
});
