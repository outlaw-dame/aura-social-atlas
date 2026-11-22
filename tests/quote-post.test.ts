import { describe, expect, test } from 'bun:test';
import { CREATE_POST_DOCUMENT } from '../src/lib/bonfire/graphql/operations';
import { requestBonfireGraphQL } from '../src/lib/bonfire-graphql.server';
import { FEDIVERSE_CIRCLE, LOCAL_CIRCLE, quotePermissions } from '../src/lib/quote-policy';

describe('new posts through Bonfire createPost (quotes and who may quote)', () => {
  test('the mutation names Bonfire’s arguments in the schema’s camelCase', () => {
    for (const arg of ['createPost(', 'postContent: $postContent', 'boundary: $boundary', 'quoteId: $quoteId', 'uploadedMedia: $uploadedMedia', 'permissions: $permissions', '[BoundaryPermissionInput]', 'canonicalUri'])
      expect(CREATE_POST_DOCUMENT).toContain(arg);
  });
  test('sent once (a mutation is never retried), with the token, and its answer validated', async () => {
    let calls = 0, sent: any, auth = '';
    const fetchImpl = (async (_u: string, init: RequestInit) => {
      calls++; sent = JSON.parse(String(init.body)); auth = (init.headers as Record<string, string>).authorization;
      return new Response(JSON.stringify({ data: { createPost: { id: '01Q', activity: { canonicalUri: 'https://fedizen.net/post/01Q' } } } }));
    }) as unknown as typeof fetch;
    const variables = { postContent: { htmlBody: 'So good' }, boundary: 'public', quoteId: '01A', permissions: quotePermissions('ask') };
    const r = await requestBonfireGraphQL({
      operation: 'mutation', document: CREATE_POST_DOCUMENT, accessToken: 'tok', fetchImpl, variables,
      validate: v => (v as { createPost: { id: string } }).createPost,
    });
    expect(r.id).toBe('01Q');
    expect(calls).toBe(1);
    expect(auth).toBe('Bearer tok');
    expect(sent.variables).toEqual(variables);
  });
});

describe('who may quote (lib/quote-policy)', () => {
  const everyone = [LOCAL_CIRCLE, FEDIVERSE_CIRCLE];
  test('Bonfire’s built-in circles for this instance and the fediverse', () => {
    expect(LOCAL_CIRCLE).toBe('3SERSFR0MY0VR10CA11NSTANCE');
    expect(FEDIVERSE_CIRCLE).toBe('7EDERATEDW1THANACT1V1TYPVB');
  });
  test('anyone: everyone may quote', () => expect(quotePermissions('anyone')).toEqual([{ permission: 'quote', can: everyone, cannot: [] }]));
  test('ask: everyone may ask, and the author approves', () => expect(quotePermissions('ask')).toEqual([{ permission: 'request', can: everyone, cannot: [] }]));
  test('nobody: no one may quote or ask, whatever the preset grants', () =>
    expect(quotePermissions('nobody')).toEqual([{ permission: 'quote', can: [], cannot: everyone }, { permission: 'request', can: [], cannot: everyone }]));
});

describe('Fedizen accepts the permissions', () => {
  // bonfire_social's create_post matches each entry on %{permission:, can:, cannot:}; a missing key is a 500.
  test('every entry names both can and cannot', () => {
    for (const p of ['anyone', 'ask', 'nobody'] as const)
      for (const e of quotePermissions(p)) expect(Array.isArray(e.can) && Array.isArray(e.cannot)).toBe(true);
  });
});

describe('Fedizen-only posts (Bonfire "local" boundary)', () => {
  test('quoting is offered to people on Fedizen only; "nobody" still shuts everyone out', () => {
    expect(quotePermissions('anyone', 'local')).toEqual([{ permission: 'quote', can: [LOCAL_CIRCLE], cannot: [] }]);
    expect(quotePermissions('ask', 'local')).toEqual([{ permission: 'request', can: [LOCAL_CIRCLE], cannot: [] }]);
    expect(quotePermissions('nobody', 'local')).toEqual(quotePermissions('nobody'));
  });
  test('the server accepts "local" for createPost and sends it as the boundary', () => {
    const src = require('node:fs').readFileSync('src/lib/fedizen.functions.ts', 'utf8') as string;
    expect(src).toContain("visibility: z.enum(['public', 'unlisted', 'local'])");
    expect(src).toContain("quotePermissions(data.quotes, data.visibility === 'local' ? 'local' : 'everyone')");
  });
});

describe('circle posts (boundary "private" + permissions for the circle)', () => {
  test('the circle may see, read and reply; nobody may quote or ask to', async () => {
    const { circlePermissions } = await import('../src/lib/quote-policy');
    expect(circlePermissions(['01CIRCLE'])).toEqual([
      { permission: 'see', can: ['01CIRCLE'], cannot: [] },
      { permission: 'read', can: ['01CIRCLE'], cannot: [] },
      { permission: 'reply', can: ['01CIRCLE'], cannot: [] },
      ...quotePermissions('nobody'),
    ]);
    for (const e of circlePermissions(['01CIRCLE'])) expect(Array.isArray(e.can) && Array.isArray(e.cannot)).toBe(true);
  });
  test('only a stored read grant for every circle counts as shared; no grants at all is unknown, not missing', async () => {
    const { circleReadCheck } = await import('../src/lib/quote-policy');
    const read = (...ids: string[]) => ({ permission: 'read', can: ids.map(id => ({ id })) });
    expect(circleReadCheck([read('01A')], ['01A'])).toBe('confirmed');
    expect(circleReadCheck([read('01A')], ['01A', '01B'])).toBe('missing');
    expect(circleReadCheck([{ permission: 'see', can: [{ id: '01A' }] }], ['01A'])).toBe('missing');
    // Fedizen rc.1 answers [] for every post (its ACL isn't preloaded), seen live 2026-11-22.
    expect(circleReadCheck([], ['01A'])).toBe('unknown');
    expect(circleReadCheck(null, ['01A'])).toBe('unknown');
    expect(circleReadCheck([read('01A')], [])).toBe('unknown');
  });
  test('the mutation fixes the boundary to "private" and asks for the grants back', async () => {
    const { CREATE_CIRCLE_POST_DOCUMENT, POST_GRANTS_DOCUMENT } = await import('../src/lib/bonfire/graphql/operations');
    for (const arg of ['boundary: "private"', 'toCircles: $toCircles', 'permissions: $permissions', '[BoundaryPermissionInput]']) expect(CREATE_CIRCLE_POST_DOCUMENT).toContain(arg);
    expect(CREATE_CIRCLE_POST_DOCUMENT).not.toContain('quoteId');
    expect(POST_GRANTS_DOCUMENT).toContain('permissionGrants { permission can { id } }');
  });
});
