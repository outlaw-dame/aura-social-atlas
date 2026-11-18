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

/** The decrypted key for one provider, or null when there's none. Re-encrypts rows made with a previous secret. */
export async function credentialFor(userId: string, provider: ProviderId): Promise<Credential | null> {
  const { data, error } = await supabaseAdmin.from('atlas_ai_keys').select('provider, ciphertext, iv, key_id').eq('user_id', userId).eq('provider', provider).maybeSingle();
  if (error) throw new VaultError('storage');
  if (!data) return null;
  const { credential, stale } = await openRow(userId, data);
  if (stale) {
    const sealed = await sealCredential(userId, credential);
    await supabaseAdmin.from('atlas_ai_keys').update({ ...sealed, updated_at: new Date().toISOString() }).eq('user_id', userId).eq('provider', provider);
  }
  return credential;
}

/** What the settings page may show about saved AI keys: which providers, the key's last four characters, the models.
 *  A DeepL key isn't an AI provider's: serviceKey reads it. */
export async function savedKeys(userId: string) {
  const { data, error } = await supabaseAdmin.from('atlas_ai_keys').select('provider, hint, models, updated_at').eq('user_id', userId).neq('provider', 'deepl');
  if (error) throw new VaultError('storage');
  return (data ?? []).map(r => ({ provider: r.provider as ProviderId, hint: r.hint, models: Array.isArray(r.models) ? (r.models as string[]) : [], updatedAt: r.updated_at }));
}

/** A non-AI service's key (DeepL), decrypted, and its hint; null when there's none. */
export async function serviceKey(userId: string, service: 'deepl'): Promise<{ key: string; hint: string } | null> {
  const { data, error } = await supabaseAdmin.from('atlas_ai_keys').select('provider, ciphertext, iv, key_id, hint').eq('user_id', userId).eq('provider', service).maybeSingle();
  if (error) throw new VaultError('storage');
  if (!data) return null;
  const { credential, stale } = await openRow(userId, data);
  if (stale) await storeCredential(userId, { provider: service, key: credential.key }, data.hint, []);
  return { key: credential.key, hint: data.hint };
}

export async function storeCredential(userId: string, c: Sealable, hint: string, models: string[]) {
  const sealed = await sealCredential(userId, c);
  const { error } = await supabaseAdmin.from('atlas_ai_keys').upsert({ user_id: userId, provider: c.provider, ...sealed, hint, models, updated_at: new Date().toISOString() });
  if (error) throw new VaultError('storage');
}

export async function forgetCredential(userId: string, provider: KeyService) {
  const { error } = await supabaseAdmin.from('atlas_ai_keys').delete().eq('user_id', userId).eq('provider', provider);
  if (error) throw new VaultError('storage');
}
