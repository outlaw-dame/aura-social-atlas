/**
 * People's own AI keys, encrypted at rest. Server-only.
 *
 * - AES-256-GCM (Web Crypto, as Cloudflare Workers provide it). The encryption key is derived with HKDF-SHA-256 from
 *   the ATLAS_AI_KEY_SECRET Worker secret, which never touches the database: a copy of the table alone decrypts
 *   nothing.
 * - Each ciphertext is bound to its owner and provider as GCM additional data, so a row moved to another person or
 *   provider fails to decrypt instead of lending out someone's key.
 * - A fresh random 96-bit IV per encryption (NIST SP 800-38D §8.2.2).
 * - key_id names the secret that encrypted a row. Rotating: set the new secret, move the old one to
 *   ATLAS_AI_KEY_SECRET_PREVIOUS; rows still decrypt and are re-encrypted with the new secret the next time they're read.
 * - Keys are never returned to the browser, logged, or sent anywhere but their own provider (llm.ts).
 */
import { supabaseAdmin } from '@/integrations/supabase/client.server';
import type { Credential, ProviderId } from './providers';

export type { Credential };
/** What can have a key here: the AI providers, and DeepL for translation (lib/translation/deepl.server.ts). */
export type KeyService = ProviderId | 'deepl';
type Sealable = { provider: KeyService; key: string; account?: string };

const enc = new TextEncoder(), dec = new TextDecoder();
const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));
const unb64 = (s: string) => Uint8Array.from(atob(s), c => c.charCodeAt(0));

type Secret = { id: string; key: CryptoKey };
const secrets = new Map<string, Promise<Secret>>();

async function secretFrom(raw: string): Promise<Secret> {
  const material = await crypto.subtle.importKey('raw', enc.encode(raw), 'HKDF', false, ['deriveKey', 'deriveBits']);
  const salt = enc.encode('atlas-ai-keys');
  const key = await crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt, info: enc.encode('aes-256-gcm v1') }, material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  const idBits = new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info: enc.encode('key id v1') }, material, 64));
  return { id: [...idBits].map(b => b.toString(16).padStart(2, '0')).join(''), key };
}

/** The current secret and the previous one (while rotating). Null when the server isn't set up for keys. */
async function loadSecrets(): Promise<{ current: Secret; all: Secret[] } | null> {
  // At least 32 characters: `openssl rand -base64 48` makes a good one.
  const current = process.env['ATLAS_AI_KEY_SECRET'], previous = process.env['ATLAS_AI_KEY_SECRET_PREVIOUS'];
  if (!current || current.length < 32) return null;
  const raw = previous && previous.length >= 32 && previous !== current ? [current, previous] : [current];
  const all = await Promise.all(raw.map(r => { if (!secrets.has(r)) secrets.set(r, secretFrom(r)); return secrets.get(r)!; }));
  return { current: all[0], all };
}

export async function vaultReady(): Promise<boolean> {
  return !!(await loadSecrets());
}

const aad = (userId: string, provider: KeyService) => enc.encode(`atlas-ai-key|${userId}|${provider}`);

export async function sealCredential(userId: string, c: Sealable) {
  const s = await loadSecrets();
  if (!s) throw new VaultError('not-configured');
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plain = enc.encode(JSON.stringify({ key: c.key, ...(c.account ? { account: c.account } : {}) }));
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad(userId, c.provider) }, s.current.key, plain));
  return { ciphertext: b64(sealed), iv: b64(iv), key_id: s.current.id };
}

export class VaultError extends Error {
  constructor(public code: 'not-configured' | 'unreadable' | 'storage') { super(code); }
}

type Row = { provider: string; ciphertext: string; iv: string; key_id: string };

export async function openRow(userId: string, row: Row): Promise<{ credential: Credential; stale: boolean }> {
  const s = await loadSecrets();
  if (!s) throw new VaultError('not-configured');
  const secret = s.all.find(x => x.id === row.key_id);
  if (!secret) throw new VaultError('unreadable');
  try {
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(row.iv), additionalData: aad(userId, row.provider as KeyService) }, secret.key, unb64(row.ciphertext));
    const v = JSON.parse(dec.decode(plain)) as { key: string; account?: string };
    return { credential: { provider: row.provider as ProviderId, key: v.key, ...(v.account ? { account: v.account } : {}) }, stale: secret.id !== s.current.id };
  } catch {
    throw new VaultError('unreadable');
  }
}

/** A saved AI key as the settings page may see it: never the key itself, only its last four characters. */
export type KeyRow = { id: string; provider: ProviderId; label: string | null; hint: string; models: string[]; model: string | null };

/** The decrypted key with this id, or null when the person has none by that id. Re-encrypts rows made with a
 *  previous secret. */
export async function credentialById(userId: string, keyId: string): Promise<Credential | null> {
  const { data, error } = await supabaseAdmin.from('atlas_ai_keys').select('id, provider, ciphertext, iv, key_id').eq('user_id', userId).eq('id', keyId).neq('provider', 'deepl').maybeSingle();
  if (error) throw new VaultError('storage');
  if (!data) return null;
  const { credential, stale } = await openRow(userId, data);
  if (stale) {
    const sealed = await sealCredential(userId, credential);
    await supabaseAdmin.from('atlas_ai_keys').update({ ...sealed, updated_at: new Date().toISOString() }).eq('user_id', userId).eq('id', keyId);
  }
  return credential;
}

/** The person's AI keys, oldest first (the order backups are tried in). A DeepL key isn't an AI provider's:
 *  serviceKey reads it. */
export async function savedKeys(userId: string): Promise<KeyRow[]> {
  const { data, error } = await supabaseAdmin.from('atlas_ai_keys').select('id, provider, label, hint, models, model, created_at').eq('user_id', userId).neq('provider', 'deepl').order('created_at');
  if (error) throw new VaultError('storage');
  return (data ?? []).map(r => ({
    id: r.id as string, provider: r.provider as ProviderId, label: (r.label as string | null) ?? null, hint: r.hint as string,
    models: Array.isArray(r.models) ? (r.models as string[]) : [], model: (r.model as string | null) ?? null,
  }));
}

/** A non-AI service's key (DeepL), decrypted, and its hint; null when there's none. */
export async function serviceKey(userId: string, service: 'deepl'): Promise<{ key: string; hint: string } | null> {
  const { data, error } = await supabaseAdmin.from('atlas_ai_keys').select('id, provider, ciphertext, iv, key_id, hint').eq('user_id', userId).eq('provider', service).maybeSingle();
  if (error) throw new VaultError('storage');
  if (!data) return null;
  const { credential, stale } = await openRow(userId, data);
  if (stale) await storeServiceKey(userId, service, credential.key, data.hint);
  return { key: credential.key, hint: data.hint };
}

/** Keeps a new AI key (its own row: a person may have several from one company). Returns its id. */
export async function addCredential(userId: string, c: Sealable & { provider: ProviderId }, hint: string, models: string[], extra: { label?: string | null; model?: string | null }): Promise<string> {
  const sealed = await sealCredential(userId, c);
  const { data, error } = await supabaseAdmin.from('atlas_ai_keys').insert({
    user_id: userId, provider: c.provider, ...sealed, hint, models, label: extra.label ?? null, model: extra.model ?? null, updated_at: new Date().toISOString(),
  }).select('id').single();
  if (error || !data) throw new VaultError('storage');
  return data.id as string;
}

/** Changes a saved AI key's name or model (never the key itself: a new key is a new row). */
export async function updateKeyDetails(userId: string, keyId: string, patch: { label?: string | null; model?: string | null }) {
  const { error } = await supabaseAdmin.from('atlas_ai_keys').update({ ...patch, updated_at: new Date().toISOString() }).eq('user_id', userId).eq('id', keyId).neq('provider', 'deepl');
  if (error) throw new VaultError('storage');
}

/** Keeps the DeepL key, replacing the one there was. */
export async function storeServiceKey(userId: string, service: 'deepl', key: string, hint: string) {
  const sealed = await sealCredential(userId, { provider: service, key });
  const { data: existing, error: readError } = await supabaseAdmin.from('atlas_ai_keys').select('id').eq('user_id', userId).eq('provider', service).maybeSingle();
  if (readError) throw new VaultError('storage');
  const row = { ...sealed, hint, models: [], updated_at: new Date().toISOString() };
  const { error } = existing
    ? await supabaseAdmin.from('atlas_ai_keys').update(row).eq('user_id', userId).eq('id', existing.id)
    : await supabaseAdmin.from('atlas_ai_keys').insert({ user_id: userId, provider: service, ...row });
  if (error) throw new VaultError('storage');
}

export async function forgetKey(userId: string, keyId: string) {
  const { error } = await supabaseAdmin.from('atlas_ai_keys').delete().eq('user_id', userId).eq('id', keyId).neq('provider', 'deepl');
  if (error) throw new VaultError('storage');
}

export async function forgetServiceKey(userId: string, service: 'deepl') {
  const { error } = await supabaseAdmin.from('atlas_ai_keys').delete().eq('user_id', userId).eq('provider', service);
  if (error) throw new VaultError('storage');
}
