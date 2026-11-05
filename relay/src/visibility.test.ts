import { describe, test } from 'node:test';
import { deepStrictEqual, strictEqual } from 'node:assert';
import { Activity, Object as APObject } from '@fedify/vocab';
import { AS_PUBLIC, authorizeForward, prefilterRaw, type AuthorizeDeps } from './visibility.ts';

const allowedDomains = ['fedizen.net', 'other.example'];
const subscriberHosts = new Set(['fedizen.net']);
const ALICE = 'https://fedizen.net/users/alice';
const FOLLOWERS = `${ALICE}/followers`;
const note = (extra: Record<string, unknown> = {}) => ({ id: 'https://fedizen.net/notes/1', type: 'Note', attributedTo: ALICE, content: 'hi', to: [AS_PUBLIC], ...extra });
const create = (extra: Record<string, unknown> = {}, obj: Record<string, unknown> = note()) => ({ '@context': 'https://www.w3.org/ns/activitystreams', id: 'https://fedizen.net/activities/1', type: 'Create', actor: ALICE, to: [AS_PUBLIC], cc: [FOLLOWERS], object: obj, ...extra });
const pre = (body: unknown, hosts = subscriberHosts) => prefilterRaw({ body, allowedDomains, subscriberHosts: hosts });

describe('raw prefilter — content', () => {
  test('public Create from a subscriber passes', () => strictEqual(pre(create()).ok, true));
  test('as:Public and Public aliases count as public', () => {
    strictEqual(pre(create({ to: 'as:Public', cc: [] }, note({ to: 'as:Public' }))).ok, true);
    strictEqual(pre(create({ to: [], cc: ['Public'] }, note({ to: [], cc: 'Public' }))).ok, true);
  });
  test('followers-only is rejected', () => strictEqual(pre(create({ to: [FOLLOWERS], cc: [] })).ok, false));
  test('direct message is rejected', () => strictEqual(pre(create({ to: ['https://other.example/users/bob'], cc: [] })).ok, false));
  test('missing recipients are rejected', () => strictEqual(pre(create({ to: undefined, cc: undefined })).ok, false));
  test('hidden bto/bcc recipients make it non-public', () => strictEqual(pre(create({ bcc: ['https://other.example/users/bob'] })).ok, false));
  test('public activity wrapping a followers-only object is rejected', () => strictEqual(pre(create({}, note({ to: [FOLLOWERS] }))).ok, false));
  test('allowlisted but not subscribed server is rejected', () => strictEqual(pre(create({ actor: 'https://other.example/users/bob', id: 'https://other.example/a/1' })).ok, false));
  test('non-allowlisted server is rejected', () => strictEqual(pre(create({ actor: 'https://spam.example/u' })).ok, false));
  test('Move is never relayed', () => strictEqual(pre({ type: 'Move', id: 'https://fedizen.net/m', actor: ALICE, to: [AS_PUBLIC], object: ALICE }).ok, false));
  test('unknown types are rejected', () => strictEqual(pre({ type: 'Like', id: 'https://fedizen.net/l', actor: ALICE, to: [AS_PUBLIC] }).ok, false));
});

describe('raw prefilter — control plane', () => {
  const follow = { id: 'https://fedizen.net/f/1', type: 'Follow', actor: 'https://fedizen.net/relay', object: AS_PUBLIC };
  test('Follow handshake without Public addressing is allowed (even before subscribing)', () => strictEqual(pre(follow, new Set()).ok, true));
  test('Follow from a non-allowlisted server is rejected', () => strictEqual(pre({ ...follow, actor: 'https://spam.example/relay' }).ok, false));
  test('Undo of own Follow is allowed', () => strictEqual(pre({ type: 'Undo', id: 'https://fedizen.net/u/1', actor: follow.actor, object: follow }).ok, true));
  test('Undo of someone else\'s Follow is rejected', () => strictEqual(pre({ type: 'Undo', id: 'https://fedizen.net/u/1', actor: ALICE, object: follow }).ok, false));
  test('Undo by reference to another origin is rejected', () => strictEqual(pre({ type: 'Undo', id: 'https://fedizen.net/u/1', actor: ALICE, object: 'https://other.example/f/1' }).ok, false));
  test('Accept and Reject are control plane', () => {
    strictEqual(pre({ type: 'Accept', id: 'https://fedizen.net/a', actor: follow.actor, object: 'https://relay.example/f' }, new Set()).ok, true);
    strictEqual(pre({ type: 'Reject', id: 'https://fedizen.net/r', actor: follow.actor, object: 'https://relay.example/f' }, new Set()).ok, true);
  });
});

describe('authenticated policy', () => {
  const seen = new Set<string>();
  const deps = (over: Partial<AuthorizeDeps> = {}): AuthorizeDeps => ({
    allowedDomains,
    subscriberHosts: async () => subscriberHosts,
    loadObject: async (a) => (await a.getObject()) ?? null,
    markSeen: async (id) => (seen.has(id) ? false : (seen.add(id), true)),
    ...over,
  });
  const parse = (j: unknown) => Activity.fromJsonLd(j) as Promise<Activity>;
  const reason = (d: Awaited<ReturnType<typeof authorizeForward>>) => (d.ok ? 'ok' : d.reason);

  test('valid public Create is allowed once; duplicate id is dropped', async () => {
    const a = await parse(create({ id: 'https://fedizen.net/activities/dup' }));
    strictEqual(reason(await authorizeForward(a, deps())), 'ok');
    strictEqual(reason(await authorizeForward(a, deps())), 'duplicate activity');
  });
  test('followers-only activity is dropped', async () => strictEqual(reason(await authorizeForward(await parse(create({ to: [FOLLOWERS], cc: [] })), deps())), 'activity is not public'));
  test('direct message is dropped', async () => strictEqual(reason(await authorizeForward(await parse(create({ to: ['https://other.example/users/bob'], cc: [] })), deps())), 'activity is not public'));
  test('missing recipients are dropped', async () => strictEqual(reason(await authorizeForward(await parse(create({ to: undefined, cc: undefined })), deps())), 'activity is not public'));
  test('private object inside public Create is dropped', async () => strictEqual(reason(await authorizeForward(await parse(create({ id: 'https://fedizen.net/activities/p' }, note({ to: [FOLLOWERS] }))), deps())), 'object is not public'));
  test('object attributed to another actor is dropped', async () => strictEqual(reason(await authorizeForward(await parse(create({ id: 'https://fedizen.net/activities/x' }, note({ attributedTo: 'https://fedizen.net/users/eve' }))), deps())), 'object attributed to someone else'));
  test('activity id from another origin is dropped', async () => strictEqual(reason(await authorizeForward(await parse(create({ id: 'https://other.example/a/1' })), deps())), 'activity id missing or from another origin'));
  test('allowlisted non-subscriber is dropped', async () => strictEqual(reason(await authorizeForward(await parse(create()), deps({ subscriberHosts: async () => new Set() }))), 'sender server is not a current subscriber'));
  test('Announce of a private object is dropped', async () => {
    const ann = await parse({ id: 'https://fedizen.net/ann/1', type: 'Announce', actor: ALICE, to: [AS_PUBLIC], object: 'https://other.example/notes/9' });
    const priv = await APObject.fromJsonLd({ '@context': 'https://www.w3.org/ns/activitystreams', id: 'https://other.example/notes/9', type: 'Note', to: ['https://other.example/users/bob/followers'] });
    strictEqual(reason(await authorizeForward(ann, deps({ loadObject: async () => priv }))), 'announced object is not public');
    strictEqual(reason(await authorizeForward(ann, deps({ loadObject: async () => null }))), 'announced object unavailable');
  });
  test('Announce of a public object is allowed', async () => {
    const ann = await parse({ id: 'https://fedizen.net/ann/2', type: 'Announce', actor: ALICE, to: [AS_PUBLIC], object: 'https://other.example/notes/10' });
    const pub = await APObject.fromJsonLd({ '@context': 'https://www.w3.org/ns/activitystreams', id: 'https://other.example/notes/10', type: 'Note', to: [AS_PUBLIC] });
    strictEqual(reason(await authorizeForward(ann, deps({ loadObject: async () => pub }))), 'ok');
  });
  test('Delete of own object is allowed; of another origin is dropped', async () => {
    strictEqual(reason(await authorizeForward(await parse({ id: 'https://fedizen.net/d/1', type: 'Delete', actor: ALICE, to: [AS_PUBLIC], object: 'https://fedizen.net/notes/1' }), deps())), 'ok');
    strictEqual(reason(await authorizeForward(await parse({ id: 'https://fedizen.net/d/2', type: 'Delete', actor: ALICE, to: [AS_PUBLIC], object: 'https://other.example/notes/1' }), deps())), 'delete of another origin');
  });
  test('public profile Update of the signer is allowed', async () => {
    strictEqual(reason(await authorizeForward(await parse({ id: 'https://fedizen.net/up/1', type: 'Update', actor: ALICE, to: [AS_PUBLIC], object: { id: ALICE, type: 'Person' } }), deps())), 'ok');
  });
  test('Move is dropped', async () => {
    const d = await authorizeForward(await parse({ id: 'https://fedizen.net/mv/1', type: 'Move', actor: ALICE, to: [AS_PUBLIC], object: ALICE, target: 'https://other.example/u' }), deps());
    deepStrictEqual(reason(d), 'Move is not relayed');
  });
});
