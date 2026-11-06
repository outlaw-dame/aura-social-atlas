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
  test('rejects cross-origin attribution, absent authors, and private announced objects', () => {
    const accepted = new Set([RELAY]);
    const base = body();
    const reject = (object: Record<string, unknown>) => authorizeIngest({
      body: { ...base, object },
      subscribedActors: accepted,
    });
    expect(reject({ ...base.object, attributedTo: 'https://unrelated.example/actors/forged' }))
      .toEqual({ ok: false, reason: 'original author is missing or has a different origin' });
    expect(reject({ ...base.object, attributedTo: undefined }))
      .toEqual({ ok: false, reason: 'original author is missing or has a different origin' });
    expect(reject({ ...base.object, cc: [], to: ['https://knitting.example/followers'] }))
      .toEqual({ ok: false, reason: 'announced object is not public' });
    expect(reject({ ...base.object, attributedTo: 'http://knitting.example/users/anna' }))
      .toEqual({ ok: false, reason: 'original author is missing or has a different origin' });
  });
  test('Create requires exact signed actor attribution and same-origin object', () => {
    const actor = 'https://relay.fedi.buzz/tag/knitting';
    const accepted = new Set([actor]);
    const create = {
      id: 'https://relay.fedi.buzz/activities/create',
      type: 'Create',
      actor,
      to: [AS_PUBLIC],
      object: {
        id: 'https://relay.fedi.buzz/notes/verified',
        type: 'Note',
        attributedTo: actor,
        to: [AS_PUBLIC],
        content: 'Verified content',
      },
    };
    expect(authorizeIngest({ body: create, subscribedActors: accepted }).ok).toBe(true);
    expect(authorizeIngest({
      body: { ...create, object: { ...create.object, attributedTo: 'https://relay.fedi.buzz/actors/other' } },
      subscribedActors: accepted,
    })).toEqual({ ok: false, reason: 'Create author does not match verified actor' });
    expect(authorizeIngest({
      body: { ...create, object: { ...create.object, id: 'https://different.example/notes/forged' } },
      subscribedActors: accepted,
    })).toEqual({ ok: false, reason: 'original author is missing or has a different origin' });
    expect(authorizeIngest({
      body: { ...create, to: [] },
      subscribedActors: accepted,
    })).toEqual({ ok: false, reason: 'activity is not public' });
  });
});
