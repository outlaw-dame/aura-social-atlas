/** Read-only external relay actor assessment, shared by probe and tests. */
import type { Actor } from '@fedify/vocab';
import { resolveSubscriptionTarget, validateRelayActor } from './subscribe.ts';
import { checkRemoteUrl } from './urlguard.ts';

export type ProbeInput = { type: 'tag' | 'instance'; value: string } | { type: 'actor'; value: string; kind: 'litepub' };

export type ProbeReport = {
  ok: boolean;
  requestedActor: string;
  canonicalActor: string | null;
  protocol: string;
  reason: string | null;
};

export async function assessRelayActor(
  input: ProbeInput,
  lookup: (url: string) => Promise<Actor | null>,
): Promise<ProbeReport> {
  const target = resolveSubscriptionTarget(input);
  if (!target.ok) return { ok: false, requestedActor: '', canonicalActor: null, protocol: input.type, reason: target.error };
  const requestedActor = target.actorUrl;
  const protocol = target.kind;
  if (!checkRemoteUrl(requestedActor).ok) return { ok: false, requestedActor, canonicalActor: null, protocol, reason: 'unsafe actor URL' };
  let actor: Actor | null;
  try {
    actor = await lookup(requestedActor);
  } catch {
    return { ok: false, requestedActor, canonicalActor: null, protocol, reason: 'actor lookup failed' };
  }
  const validated = validateRelayActor(actor, requestedActor, protocol);
  if (!validated.ok) return { ok: false, requestedActor, canonicalActor: actor?.id?.href ?? null, protocol, reason: validated.error };
  return { ok: true, requestedActor, canonicalActor: validated.canonicalActorUrl, protocol, reason: null };
}
