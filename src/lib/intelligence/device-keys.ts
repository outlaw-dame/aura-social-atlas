/**
 * Keys kept on this device only (opt-in). Browser-only.
 *
 * The key is encrypted at rest in IndexedDB with AES-256-GCM under a non-extractable Web Crypto key, bound to the
 * Atlas user and provider as additional data, so the raw key never sits in storage and the stored copy can't be
 * lifted into another profile, browser or origin. It's never sent to Atlas's server: the browser calls the provider
 * itself (llm.ts), where the provider allows it (not Cloudflare).
 *
 * What this can't do, and the settings page says so: to call the provider the page must decrypt the key, so a script
 * running in Atlas's page (an injected script or a malicious extension) could read it. Keys kept on Atlas's server
 * can't be read that way. Safari may also clear a site's storage after 7 days without a visit, unless Atlas is on
 * the Home Screen; the key then has to be entered again.
 */
import { chatModels, isEmbeddingsOnly, keyHint, type Credential, type ProviderId } from './providers';
import { listModels } from './llm';

const DB = 'atlas-ai', VERSION = 1;
type Sealed = { iv: Uint8Array<ArrayBuffer>; data: ArrayBuffer; hint: string; models: string[]; provider: ProviderId; id?: string; label?: string | null; at?: number };
/**
 * A key on this device. `id` tells keys from one company apart; a key saved before there could be several has its
 * company's name as id (its record was stored under that name), so it keeps working unchanged.
 */
export type DeviceKey = { id: string; provider: ProviderId; label: string | null; hint: string; models: string[] };
/** Which device key to use and its model. Older prefs name only the company: their key is the one with that id. */
export type DevicePrefs = { keyId?: string; provider: ProviderId; model: string } | null;

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, VERSION);
    req.onupgradeneeded = () => { for (const s of ['wrap', 'keys', 'prefs']) if (!req.result.objectStoreNames.contains(s)) req.result.createObjectStore(s); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  const db = await open();
  try {
    return await new Promise<T | undefined>((resolve, reject) => {
      const t = db.transaction(store, mode);
      const req = fn(t.objectStore(store));
      t.oncomplete = () => resolve(req ? req.result : undefined);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  } finally {
    db.close();
  }
}

/** This browser's wrapping key: made once, non-extractable, so script can use it but never read or copy it out. */
async function wrapKey(): Promise<CryptoKey> {
  const have = await tx<CryptoKey>('wrap', 'readonly', s => s.get('k'));
  if (have) return have;
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  await tx('wrap', 'readwrite', s => { s.put(key, 'k'); });
  return key;
}

const recordId = (uid: string, keyId: string) => `${uid}:${keyId}`;
const aad = (uid: string, provider: ProviderId) => new TextEncoder().encode(`atlas-device-key|${uid}|${provider}`);
const asKey = (k: Sealed): DeviceKey => ({ id: k.id ?? k.provider, provider: k.provider, label: k.label ?? null, hint: k.hint, models: k.models });

/** Whether this browser can keep a key (IndexedDB and Web Crypto available, e.g. not some private windows). */
export function deviceKeysSupported(): boolean {
  return typeof indexedDB !== 'undefined' && typeof crypto !== 'undefined' && !!crypto.subtle;
}

/** Checks the key with its provider from this browser (listing its models), then keeps it encrypted here, beside any
 *  other keys (from this company or others). */
export async function saveDeviceKey(uid: string, c: Credential, label?: string | null): Promise<DeviceKey> {
  // A key for embeddings only is checked by embedding one word and kept with no chat models.
  const models = isEmbeddingsOnly(c.provider)
    ? (await (await import('./embeddings')).embedWith(c, ['Atlas'], 'query'), [])
    : chatModels(c.provider, await listModels(c)).slice(0, 200);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plain = new TextEncoder().encode(JSON.stringify({ key: c.key, ...(c.account ? { account: c.account } : {}) }));
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad(uid, c.provider) }, await wrapKey(), plain);
  const keyId = crypto.randomUUID();
  const sealed: Sealed = { iv, data, hint: keyHint(c.key), models, provider: c.provider, id: keyId, label: label?.trim() ? label.trim().slice(0, 40) : null, at: Date.now() };
  await tx('keys', 'readwrite', s => { s.put(sealed, recordId(uid, keyId)); });
  return asKey(sealed);
}

/** This person's keys on this device, oldest first (the order backups are tried in). */
export async function deviceKeys(uid: string): Promise<DeviceKey[]> {
  if (!deviceKeysSupported()) return [];
  try {
    const all = await tx<Sealed[]>('keys', 'readonly', s => s.getAll(IDBKeyRange.bound(`${uid}:`, `${uid}:\uffff`)));
    return (all ?? []).sort((x, y) => (x.at ?? 0) - (y.at ?? 0)).map(asKey);
  } catch {
    return [];
  }
}

/** The decrypted key, only for the moment of a call; null when there's none (or it can't be opened here). */
export async function deviceCredential(uid: string, keyId: string): Promise<Credential | null> {
  try {
    const k = await tx<Sealed>('keys', 'readonly', s => s.get(recordId(uid, keyId)));
    if (!k) return null;
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: k.iv, additionalData: aad(uid, k.provider) }, await wrapKey(), k.data);
    const v = JSON.parse(new TextDecoder().decode(plain)) as { key: string; account?: string };
    return { provider: k.provider, key: v.key, ...(v.account ? { account: v.account } : {}) };
  } catch {
    return null;
  }
}

/** Names a device key ("Work", "Personal"), or clears its name. */
export async function renameDeviceKey(uid: string, keyId: string, label: string | null) {
  const k = await tx<Sealed>('keys', 'readonly', s => s.get(recordId(uid, keyId)));
  if (!k) return;
  await tx('keys', 'readwrite', s => { s.put({ ...k, label: label?.trim() ? label.trim().slice(0, 40) : null }, recordId(uid, keyId)); });
}

export async function removeDeviceKey(uid: string, keyId: string) {
  await tx('keys', 'readwrite', s => { s.delete(recordId(uid, keyId)); });
  const p = await devicePrefs(uid);
  if (p && (p.keyId ?? p.provider) === keyId) await setDevicePrefs(uid, null);
}

/** Which device key to use, and its model. When set, it's used instead of a key kept on Atlas's server. */
export async function devicePrefs(uid: string): Promise<DevicePrefs> {
  try { return (await tx<DevicePrefs>('prefs', 'readonly', s => s.get(uid))) ?? null; } catch { return null; }
}

export async function setDevicePrefs(uid: string, prefs: DevicePrefs) {
  await tx('prefs', 'readwrite', s => { if (prefs) s.put(prefs, uid); else s.delete(uid); });
}
