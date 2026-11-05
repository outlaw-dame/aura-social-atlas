/**
 * Relay forwarding policy. Two layers:
 *
 * 1. `prefilterRaw` runs on the raw JSON before Fedify. It is cheap and rejects obviously
 *    non-public or non-subscriber traffic, but it trusts nothing for authorization on its own.
 * 2. `authorizeForward` runs inside Fedify's inbox pipeline, AFTER Fedify has verified the HTTP
 *    signature (or LD signature / object proof) and that the signer owns `actor`. This is the
 *    authoritative check; every content activity must pass it before it is relayed.
 *
 * Control-plane activities (Follow / Undo / Accept / Reject) are handled separately and are never
 * required to be addressed to Public.
 */
import type { Activity, Object as APObject } from '@fedify/vocab';
import { Announce, Create, Delete, Move, Update } from '@fedify/vocab';

export const AS_PUBLIC = 'https://www.w3.org/ns/activitystreams#Public';
const PUBLIC_ALIASES = new Set([AS_PUBLIC, 'as:Public', 'Public']);

export const CONTROL_TYPES = new Set(['Follow', 'Undo', 'Accept', 'Reject']);
export const CONTENT_TYPES = new Set(['Create', 'Update', 'Delete', 'Announce', 'Move']);

export type Decision = { ok: true } | { ok: false; status: number; reason: string };
const allow: Decision = { ok: true };
const deny = (reason: string, status = 403): Decision => ({ ok: false, status, reason });

function hostOf(id: unknown): string | null {
  try { const u = new URL(String(id)); return u.protocol === 'https:' || u.hostname === 'localhost' ? u.hostname.toLowerCase() : null; } catch { return null; }
}
function idOf(v: unknown): string | null {
  if (typeof v === 'string') return v;
  if (v && typeof v === 'object' && typeof (v as { id?: unknown }).id === 'string') return (v as { id: string }).id;
  return null;
}
function list(v: unknown): unknown[] { return v == null ? [] : Array.isArray(v) ? v : [v]; }
function typeOf(v: unknown): string | null {
  const t = v && typeof v === 'object' ? (v as { type?: unknown }).type : null;
  return typeof t === 'string' ? t : Array.isArray(t) && typeof t[0] === 'string' ? t[0] : null;
}

/** Raw-JSON public check: Public in to/cc and no hidden bto/bcc recipients. */
export function rawIsPublic(o: unknown): boolean {
  if (!o || typeof o !== 'object') return false;
  const r = o as Record<string, unknown>;
  if (list(r.bto).length || list(r.bcc).length) return false;
  return [...list(r.to), ...list(r.cc)].some(x => PUBLIC_ALIASES.has(idOf(x) ?? ''));
}

export type PrefilterInput = { body: unknown; allowedDomains: string[]; subscriberHosts: Set<string> };

/** Pre-signature filter on the claimed fields. Never sufficient to allow anything by itself. */
export function prefilterRaw({ body, allowedDomains, subscriberHosts }: PrefilterInput): Decision {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return deny('not an object', 400);
  const b = body as Record<string, unknown>;
  const type = typeOf(b);
  const actor = idOf(b.actor);
  const host = hostOf(actor);
  if (!type) return deny('missing type', 400);
  if (!host || !allowedDomains.includes(host)) return deny('actor not allowlisted');

  if (CONTROL_TYPES.has(type)) {
    if (type === 'Undo') {
      // The library resolves the undone Follow with crossOrigin "trust"; only accept Undo of the sender's own Follow.
      const inner = b.object;
      if (inner && typeof inner === 'object') {
        if (idOf((inner as Record<string, unknown>).actor) !== actor) return deny('undo of another actor');
      } else if (hostOf(inner) !== host) return deny('undo object from another origin');
    }
    return allow;
  }
  if (!CONTENT_TYPES.has(type)) return deny('unsupported activity type', 422);
  if (type === 'Move') return deny('Move is not relayed');
  if (!subscriberHosts.has(host)) return deny('sender server is not a current subscriber');
  if (typeof b.id !== 'string' || !hostOf(b.id)) return deny('missing activity id', 400);
  if (!rawIsPublic(b)) return deny('activity is not public');
  // When the object is embedded we can reject private content early; the authoritative check repeats this.
  const obj = b.object;
  if ((type === 'Create' || type === 'Update') && obj && typeof obj === 'object' && idOf(obj) !== actor && !rawIsPublic(obj)) return deny('object is not public');
  return allow;
}

// ---------- authenticated layer ----------

function isPublic(o: APObject | Activity): boolean {
  if (o.btoIds.length || o.bccIds.length) return false;
  return [...o.toIds, ...o.ccIds].some(u => u.href === AS_PUBLIC);
}

export type AuthorizeDeps = {
  allowedDomains: string[];
  subscriberHosts: () => Promise<Set<string>>;
  /** Resolves the activity's object (embedded or fetched with the SSRF-safe loader). Null = unavailable. */
  loadObject: (a: Activity) => Promise<APObject | null>;
  /** Returns true the first time an activity id is seen, false for duplicates. */
  markSeen: (id: string) => Promise<boolean>;
};

/** Authoritative policy on a signature-verified activity (actorId is the authenticated signer). */
export async function authorizeForward(activity: Activity, deps: AuthorizeDeps): Promise<Decision> {
  const actorId = activity.actorId;
  const host = actorId && hostOf(actorId.href);
  if (!actorId || !host || !deps.allowedDomains.includes(host)) return deny('actor not allowlisted');
  if (!(await deps.subscriberHosts()).has(host)) return deny('sender server is not a current subscriber');
  if (!activity.id || hostOf(activity.id.href) !== host) return deny('activity id missing or from another origin');
  if (activity instanceof Move) return deny('Move is not relayed');
  if (!isPublic(activity)) return deny('activity is not public');

  if (activity instanceof Delete) {
    if (!activity.objectId || hostOf(activity.objectId.href) !== host) return deny('delete of another origin');
  } else if (activity instanceof Update && activity.objectId?.href === actorId.href) {
    // Profile update of the signer itself: actors carry no to/cc, the activity's Public addressing governs.
  } else if (activity instanceof Create || activity instanceof Update) {
    const obj = await deps.loadObject(activity);
    if (!obj?.id || hostOf(obj.id.href) !== host) return deny('object missing or from another origin');
    if (obj.attributionIds.some(a => a.href !== actorId.href)) return deny('object attributed to someone else');
    if (!isPublic(obj)) return deny('object is not public');
  } else if (activity instanceof Announce) {
    const obj = await deps.loadObject(activity);
    if (!obj?.id) return deny('announced object unavailable');
    if (!isPublic(obj)) return deny('announced object is not public');
  } else {
    return deny('unsupported activity type');
  }

  if (!(await deps.markSeen(activity.id.href))) return deny('duplicate activity', 200);
  return allow;
}
