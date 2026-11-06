/**
 * Ingestion policy. Everything here runs AFTER Fedify has verified the HTTP
 * signature of the inbound delivery (and, where present, the LD proof), so the
 * activity's `actor` is authenticated — but authentication alone is not
 * authorization:
 *
 *  1. The delivering actor must be a currently-accepted subscription
 *     (a relay actor we explicitly followed and that accepted us).
 *  2. The activity must be public: as:Public in `to` or `cc`. For Announce,
 *     both the Announce itself and (when embedded) the announced object.
 *  3. Provenance: the announced/created object's origin is recorded and the
 *     original author is kept as attribution. The gateway never re-publishes,
 *     never re-signs, and never presents relayed content as its own.
 */

import { PUBLIC_COLLECTION } from '@fedify/vocab';
import { originOf, checkRemoteUrl } from './urlguard.ts';

export const AS_PUBLIC = PUBLIC_COLLECTION.href;

type IdLike = { href?: string } | string | null | undefined;

function idHref(v: IdLike): string | null {
  if (v == null) return null;
  if (typeof v === 'string') return v;
  return typeof v.href === 'string' ? v.href : null;
}

/** True when as:Public appears in to or cc of the given raw audience arrays. */
export function addressesPublic(to: unknown, cc: unknown): boolean {
  const all = [...(Array.isArray(to) ? to : to ? [to] : []), ...(Array.isArray(cc) ? cc : cc ? [cc] : [])];
  return all.some(entry => idHref(entry as IdLike) === AS_PUBLIC);
}

export type IngestDecision =
  | { ok: true; objectId: string; objectOrigin: string; authorId: string | null; embedded: Record<string, unknown> | null }
  | { ok: false; reason: string };

export type IngestInput = {
  /** Raw parsed activity JSON-LD body (already signature-verified by Fedify). */
  body: Record<string, unknown>;
  /** Hosts of relay actors with a currently-accepted subscription. */
  subscribedActors: Set<string>;
};

/**
 * Decides whether an inbound Create/Announce may be ingested, and extracts the
 * object identity + provenance. Fail closed on any ambiguity.
 */
export function authorizeIngest({ body, subscribedActors }: IngestInput): IngestDecision {
  const type = body['type'];
  if (type !== 'Create' && type !== 'Announce') return { ok: false, reason: 'unsupported activity type' };

  const actorId = idHref(body['actor'] as IdLike);
  if (!actorId || !subscribedActors.has(actorId)) return { ok: false, reason: 'actor is not an accepted subscription' };

  if (!addressesPublic(body['to'], body['cc'])) return { ok: false, reason: 'activity is not public' };

  const rawObject = body['object'];
  let objectId: string | null = null;
  let embedded: Record<string, unknown> | null = null;
  if (typeof rawObject === 'string') objectId = rawObject;
  else if (rawObject && typeof rawObject === 'object') {
    embedded = rawObject as Record<string, unknown>;
    objectId = idHref(embedded['id'] as IdLike);
  }
  if (!objectId) return { ok: false, reason: 'activity object has no id' };

  const objectOrigin = originOf(objectId);
  if (!objectOrigin || !objectOrigin.startsWith('https://')) return { ok: false, reason: 'object id is not an absolute URL' };

  // For Announce with an embedded object, the embedded copy must also be public
  // and must not contradict the announced id (a relay could embed anything).
  if (type === 'Announce') {
    if (!embedded) return { ok: false, reason: 'announced object must be origin-fetched' };
    if (!addressesPublic(embedded['to'], embedded['cc'])) return { ok: false, reason: 'announced object is not public' };
  }

  // Author attribution: prefer the embedded object's attributedTo; for Create
  // the author must be the activity actor (already verified). We never trust
  // an embedded author claim that conflicts with the object origin when the
  // author id is a URL on a different, non-https host.
  let authorId: string | null = null;
  if (embedded) {
    authorId = idHref(embedded['attributedTo'] as IdLike) ?? idHref(embedded['actor'] as IdLike);
  }
  // A remote host must not be able to attribute its own object to an actor
  // on another host without an independently verified delegated identity.
  // For the initial implementation, require a clear same-origin author.
  if (!authorId || !checkRemoteUrl(authorId).ok || originOf(authorId) !== objectOrigin) {
    return { ok: false, reason: 'original author is missing or has a different origin' };
  }
  if (type === 'Create') {
    if (authorId && authorId !== actorId) return { ok: false, reason: 'Create author does not match verified actor' };
    authorId = actorId;
    // A Create delivered by a relay actor for someone else's object is not a
    // Create — relays announce. Reject cross-origin Creates.
    if (originOf(actorId) !== objectOrigin) return { ok: false, reason: 'Create object origin differs from actor origin' };
  }

  return { ok: true, objectId, objectOrigin, authorId, embedded };
}

/** Control-plane activities (Follow/Accept/Reject/Undo) are handled separately; this only gates content. */
export function isControlPlane(type: unknown): boolean {
  return type === 'Follow' || type === 'Accept' || type === 'Reject' || type === 'Undo' || type === 'Delete';
}
