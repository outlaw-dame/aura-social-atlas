/**
 * Subscription flows. Every subscription is explicit (admin API only), is
 * persisted BEFORE the Follow is sent (so a crash mid-send never loses the
 * correlation id), and is idempotent (re-subscribing the same actor returns
 * the existing row). The Follow object distinction:
 *
 *  - FediBuzz: Follow the selected tag/instance relay actor; it sends
 *    Announce activities for observed public objects.
 *  - Mastodon-style: requires Follow(Public) to sharedInbox and verified
 *    forwarded originals; currently refused (501), not silently simulated.
 *  - LitePub-style: Follow the relay actor AND it follows us back
 *    (reciprocal); our Follow handler accepts only subscribed actors.
 */

import type { Sql } from 'postgres';
import type { Actor } from '@fedify/vocab';
import type { Gateway } from './federation.ts';
import { createSubscription, getSubscription, listSubscriptions, reconcileLegacySubscriptionAlias, setSubscriptionState, setPendingFollowId, type Subscription, type SubscriptionKind } from './db.ts';
import { checkRemoteUrl, fediBuzzActorUrl, hostOf, originOf } from './urlguard.ts';

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

/**
 * Actor URLs may be aliases, but the ActivityPub actor's canonical ID is
 * authoritative for Accept/Reject correlation. Never trust a redirected ID,
 * inbox, scheme or port outside the administrator-approved origin.
 */
function validateRelayActor(
  actor: Actor | null,
  requestedUrl: string,
  kind: SubscriptionKind,
): { ok: true; canonicalActorUrl: string } | { ok: false; error: string } {
  if (!actor?.id) return { ok: false, error: 'remote ActivityPub actor could not be resolved' };
  const canonical = checkRemoteUrl(actor.id);
  if (!canonical.ok || originOf(actor.id) !== originOf(requestedUrl)) {
    return { ok: false, error: 'resolved actor identity is not a safe canonical URL on the approved origin' };
  }
  const inbox = actor.inboxId ? checkRemoteUrl(actor.inboxId) : null;
  if (!inbox?.ok || originOf(inbox.url) !== originOf(requestedUrl)) {
    return { ok: false, error: 'relay inbox is not a safe URL on the approved origin' };
  }
  if (kind.startsWith('fedibuzz-') && canonical.url.href !== requestedUrl) {
    return { ok: false, error: 'selected FediBuzz actor identity differs from the requested topic or instance' };
  }
  return { ok: true, canonicalActorUrl: canonical.url.href };
}

export async function subscribe(gateway: Gateway, sql: Sql, origin: string, input: SubscribeInput): Promise<SubscribeResult> {
  const target = resolveSubscriptionTarget(input);
  if (!target.ok) return { ok: false, status: 400, error: target.error };
  // Standard Mastodon relays subscribe via their shared inbox and forward
  // original-author activities, not actor-authored Announce. The 2.4.5
  // gateway cannot safely attribute that transport in an inbox listener yet.
  // Refuse rather than report a working subscription that never populates.
  if (target.kind === 'mastodon') {
    return { ok: false, status: 501, error: 'Mastodon relay shared-inbox transport verification is not yet implemented' };
  }

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
  if (!actor) return { ok: false, status: 404, error: 'remote ActivityPub actor could not be resolved' };
  const identity = validateRelayActor(actor, target.actorUrl, target.kind);
  if (!identity.ok) return { ok: false, status: 400, error: identity.error };

  const reconciled = await reconcileLegacySubscriptionAlias(sql, target.actorUrl, identity.canonicalActorUrl);
  if (reconciled === 'conflict') {
    return { ok: false, status: 409, error: 'alias and canonical relay actor subscriptions conflict; resolve explicitly as an operator' };
  }
  const followActivityId = `${origin}/activities/${crypto.randomUUID()}`;
  const { subscription, created } = await createSubscription(sql, {
    kind: target.kind,
    actorUrl: identity.canonicalActorUrl,
    actorHost,
    selector: target.selector,
    followActivityId,
  });
  if (!created) {
    // Do not silently report a disabled/rejected source as successfully
    // subscribed. Recovery is an explicit, audited operator retry action.
    if (subscription.state === 'disabled' || subscription.state === 'rejected') {
      return { ok: false, status: 409, error: 'subscription is disabled or rejected; use the explicit retry action to re-enable' };
    }
    return { ok: true, subscription, created: false };
  }

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
        if (validateRelayActor(actor, sub.actorUrl, sub.kind).ok && actor) {
          await gateway.sendUndoFollow(actor, sub.followActivityId, sub.kind);
        }
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
  if (sub.kind === 'mastodon') return { ok: false, status: 501, error: 'Mastodon relay transport verification is not implemented' };
  const actor = await gateway.lookupActor(sub.actorUrl).catch(() => null);
  if (!actor) return { ok: false, status: 502, error: 'could not resolve remote actor' };
  const identity = validateRelayActor(actor, sub.actorUrl, sub.kind);
  if (!identity.ok || identity.canonicalActorUrl !== sub.actorUrl) {
    return { ok: false, status: 502, error: 'remote actor identity or inbox could not be safely validated' };
  }
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
