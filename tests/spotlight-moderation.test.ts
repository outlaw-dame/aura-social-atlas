import { describe, expect, it } from 'bun:test';
import { allowedSpotlightItem, normalizedAccount, spotlightFilterPost, type SpotlightModeration } from '../src/lib/spotlight-curation';
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
