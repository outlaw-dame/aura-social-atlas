import { describe, expect, test } from 'bun:test';
import { AS_PUBLIC, authorizeIngest, addressesPublic } from './policy.ts';
const RELAY = 'https://relay.fedi.buzz/tag/knitting';
const AUTHOR = 'https://knitting.example/users/anna';
const ID = 'https://knitting.example/notes/123';
const body = (type: 'Create' | 'Announce' = 'Announce') => ({
  id: 'https://relay.fedi.buzz/activities/1',
  type, actor: RELAY, to: [AS_PUBLIC],
  object: { id: ID, type: 'Note', to: [AS_PUBLIC], attributedTo: AUTHOR, content: 'A public update' },
});
describe('inbound acceptance policy', () => {
  test('uses the exact subscribed actor, not only its host', () => {
    expect(authorizeIngest({ body: body(), subscribedActors: new Set([RELAY]) }).ok).toBe(true);
    const spoofed = { ...body(), actor: 'https://relay.fedi.buzz/tag/other' };
    expect(authorizeIngest({ body: spoofed, subscribedActors: new Set([RELAY]) })).toEqual({ ok: false, reason: 'actor is not an accepted subscription' });
  });
  test('rejects unverified embedded-only Announce, direct and followers-only material', () => {
    expect(authorizeIngest({ body: { ...body(), object: ID }, subscribedActors: new Set([RELAY]) }).ok).toBe(false);
    expect(authorizeIngest({ body: { ...body(), to: [] }, subscribedActors: new Set([RELAY]) }).ok).toBe(false);
    expect(authorizeIngest({ body: { ...body(), object: { ...body().object, to: ['https://example.com/followers'] } }, subscribedActors: new Set([RELAY]) }).ok).toBe(false);
    expect(addressesPublic([], AS_PUBLIC)).toBe(true);
  });
  test('rejects HTTP and ambiguous third-party objects', () => {
    expect(authorizeIngest({ body: { ...body(), object: { ...body().object, id: 'http://knitting.example/n/1' } }, subscribedActors: new Set([RELAY]) }).ok).toBe(false);
    const create = { ...body('Create'), object: { ...body().object } };
    expect(authorizeIngest({ body: create, subscribedActors: new Set([RELAY]) }).ok).toBe(false);
  });
});
