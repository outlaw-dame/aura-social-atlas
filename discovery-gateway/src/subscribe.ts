/**
 * Subscription flows. Every subscription is explicit (admin API only), is
 * persisted BEFORE the Follow is sent (so a crash mid-send never loses the
 * correlation id), and is idempotent (re-subscribing the same actor returns
 * the existing row). The Follow object distinction:
 *
 *  - Mastodon-style / FediBuzz: we Follow the relay actor; it Accepts and then
 *    Announces matching public posts to our inbox.
 *  - LitePub-style: we Follow the relay actor AND it follows us back
 *    (reciprocal); our Follow handler accepts only subscribed actors.
 */

import type { Sql } from 'postgres';
import type { Gateway } from './federation.ts';
import { createSubscription, getSubscription, listSubscriptions, setSubscriptionState, setPendingFollowId, type Subscription, type SubscriptionKind } from './db.ts';
import { checkRemoteUrl, fediBuzzActorUrl, hostOf } from './urlguard.ts';

export type SubscribeInput =
  | { type: 'tag'; value: string }
  | { type: 'instance'; value: string }
  | { type: 'actor'; value: string; kind?: 'mastodon' | 'litepub' };

export type SubscribeResult =
  | { ok: true; subscription: Subscription; created: boolean }
  | { ok: false; status: number; error: string };

export function resolveSubscriptionTarget(input: SubscribeInput): { ok: true; actorUrl: string; kind: SubscriptionKind; selector: string | null } | { ok: false; error: string } {
  if (input.type === 'tag') {
    const check = fediBuzzActorUrl('tag', input.value);
    if (!check.ok) return { ok: false, error: check.reason };
    return { ok: true, actorUrl: check.url.href, kind: 'fedibuzz-tag', selector: input.value.replace(/^#/, '').trim().toLowerCase() };
  }
  if (input.type === 'instance') {
    const check = fediBuzzActorUrl('instance', input.value);
    if (!check.ok) return { ok: false, error: check.reason };
    return { ok: true, actorUrl: check.url.href, kind: 'fedibuzz-instance', selector: input.value.trim().toLowerCase() };
  }
  const check = checkRemoteUrl(input.value);
  if (!check.ok) return { ok: false, error: check.reason };
  return { ok: true, actorUrl: check.url.href, kind: input.kind ?? 'mastodon', selector: null };
}

export async function subscribe(gateway: Gateway, sql: Sql, origin: string, input: SubscribeInput): Promise<SubscribeResult> {
  const target = resolveSubscriptionTarget(input);
  if (!target.ok) return { ok: false, status: 400, error: target.error };

  const actorHost = hostOf(target.actorUrl);
  if (!actorHost) return { ok: false, status: 400, error: 'actor URL has no host' };

  // Resolve the remote actor through Fedify's guarded loader (https-only,
  // public DNS pinned, redirect/timeout capped) before persisting anything.
  let actor;
  try {
    actor = await gateway.lookupActor(target.actorUrl);
  } catch {
    return { ok: false, status: 502, error: 'could not resolve remote actor' };
  }
  if (!actor || !actor.id) return { ok: false, status: 404, error: 'no ActivityPub actor at that URL' };
  // The resolved actor id must stay on the same origin we asked for — a
  // redirect to a different host is not the actor the operator approved.
  if (hostOf(actor.id.href) !== actorHost) return { ok: false, status: 400, error: 'resolved actor is on a different host than requested' };

  const followActivityId = `${origin}/activities/${crypto.randomUUID()}`;
  const { subscription, created } = await createSubscription(sql, {
    kind: target.kind,
    actorUrl: target.actorUrl,
    actorHost,
    selector: target.selector,
    followActivityId,
  });
  if (!created) return { ok: true, subscription, created: false };

  try {
    await gateway.sendFollow(actor, followActivityId, target.kind);
  } catch {
    // Persist-before-send: the row exists so an operator can retry or disable;
    // mark it pending and report the delivery failure honestly.
    return { ok: false, status: 502, error: 'subscription saved but Follow delivery failed; retry from the admin API' };
  }
  return { ok: true, subscription, created: true };
}

export async function unsubscribe(gateway: Gateway, sql: Sql, id: string): Promise<SubscribeResult> {
  const sub = await getSubscription(sql, id);
  if (!sub) return { ok: false, status: 404, error: 'subscription not found' };
  if (sub.state !== 'disabled') {
    await setSubscriptionState(sql, sub.id, 'disabled');
    if (sub.followActivityId) {
      try {
        const actor = await gateway.lookupActor(sub.actorUrl);
        if (actor) await gateway.sendUndoFollow(actor, sub.followActivityId, sub.kind);
      } catch {
        // State is already disabled locally; a failed Undo delivery is logged
        // but does not re-enable the subscription.
        return { ok: true, subscription: { ...sub, state: 'disabled' }, created: false };
      }
    }
  }
  return { ok: true, subscription: { ...sub, state: 'disabled' }, created: false };
}

export async function retrySubscription(gateway: Gateway, sql: Sql, origin: string, id: string): Promise<SubscribeResult> {
  const sub = await getSubscription(sql, id);
  if (!sub) return { ok: false, status: 404, error: 'subscription not found' };
  if (sub.state === 'accepted') return { ok: true, subscription: sub, created: false };
  const actor = await gateway.lookupActor(sub.actorUrl).catch(() => null);
  if (!actor) return { ok: false, status: 502, error: 'could not resolve remote actor' };
  const followActivityId = `${origin}/activities/${crypto.randomUUID()}`;
  if (!(await setPendingFollowId(sql, sub.id, followActivityId))) {
    return { ok: false, status: 409, error: 'subscription cannot be retried in this state' };
  }
  try {
    await gateway.sendFollow(actor, followActivityId, sub.kind);
  } catch {
    return { ok: false, status: 502, error: 'Follow delivery failed' };
  }
  return { ok: true, subscription: { ...sub, state: 'pending', followActivityId }, created: false };
}

export async function listAll(sql: Sql): Promise<Subscription[]> {
  return listSubscriptions(sql);
}
