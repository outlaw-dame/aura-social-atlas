/**
 * Web Push message encryption and VAPID, on Web Crypto only (Cloudflare Workers, browsers, Bun). No dependencies.
 *
 * - Message encryption: RFC 8291 (Message Encryption for Web Push) over RFC 8188's aes128gcm content coding:
 *   ECDH P-256 between the sender's one-time key and the receiver's key, HKDF-SHA-256 with the receiver's auth secret
 *   ("WebPush: info"), then a content key ("Content-Encoding: aes128gcm") and nonce ("Content-Encoding: nonce") from
 *   the salt; one record, padding delimiter 0x02.
 * - VAPID: RFC 8292. An ES256 JWT {aud: the push service's origin, exp ≤ 24 h, sub: a contact}, sent as
 *   `Authorization: vapid t=<jwt>, k=<public key>`.
 * Atlas both receives (from Fedizen, as a push relay) and sends (to the person's browsers).
 */
const enc = new TextEncoder();

export const b64u = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export function unb64u(s: string): Uint8Array<ArrayBuffer> {
  const t = s.replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(t + '='.repeat((4 - (t.length % 4)) % 4)), c => c.charCodeAt(0));
}
const concat = (...parts: Uint8Array[]) => { const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let i = 0; for (const p of parts) { out.set(p, i); i += p.length; } return out; };

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, length: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', ikm as BufferSource, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: salt as BufferSource, info: info as BufferSource }, key, length * 8));
}

/** A P-256 public key from its 65-byte uncompressed form. */
export async function importPublic(raw: Uint8Array, use: 'ecdh' | 'ecdsa'): Promise<CryptoKey> {
  if (raw.length !== 65 || raw[0] !== 4) throw new Error('bad-key');
  return crypto.subtle.importKey('raw', raw as BufferSource, use === 'ecdh' ? { name: 'ECDH', namedCurve: 'P-256' } : { name: 'ECDSA', namedCurve: 'P-256' }, true, use === 'ecdh' ? [] : ['verify']);
}

/** A P-256 private key from its 32-byte scalar and 65-byte public key (as JWK, which Web Crypto takes everywhere). */
export async function importPrivate(d: Uint8Array, pub: Uint8Array, use: 'ecdh' | 'ecdsa'): Promise<CryptoKey> {
  const jwk: JsonWebKey = { kty: 'EC', crv: 'P-256', d: b64u(d), x: b64u(pub.slice(1, 33)), y: b64u(pub.slice(33, 65)), ext: true };
  return crypto.subtle.importKey('jwk', jwk, use === 'ecdh' ? { name: 'ECDH', namedCurve: 'P-256' } : { name: 'ECDSA', namedCurve: 'P-256' }, false, use === 'ecdh' ? ['deriveBits'] : ['sign']);
}

/** A new P-256 key pair as raw bytes: the 32-byte private scalar and the 65-byte public key. */
export async function newKeyPair(): Promise<{ d: Uint8Array; pub: Uint8Array }> {
  const k = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']) as CryptoKeyPair;
  const jwk = await crypto.subtle.exportKey('jwk', k.privateKey);
  const pub = new Uint8Array(await crypto.subtle.exportKey('raw', k.publicKey));
  return { d: unb64u(jwk.d!), pub };
}

async function keys(secret: Uint8Array, auth: Uint8Array, uaPub: Uint8Array, asPub: Uint8Array, salt: Uint8Array) {
  const ikm = await hkdf(auth, secret, concat(enc.encode('WebPush: info\0'), uaPub, asPub), 32);
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);
  return { cek: await crypto.subtle.importKey('raw', cek as BufferSource, 'AES-GCM', false, ['encrypt', 'decrypt']), nonce };
}

/** Encrypts a push message for a browser subscription (its p256dh key and auth secret). */
export async function encryptPush(plain: Uint8Array, uaPub: Uint8Array, auth: Uint8Array, fixed?: { d: Uint8Array; pub: Uint8Array; salt: Uint8Array }): Promise<Uint8Array> {
  if (plain.length > 3993) throw new Error('too-large'); // one 4096-byte record, less the header and tag
  const as = fixed ?? { ...(await newKeyPair()), salt: crypto.getRandomValues(new Uint8Array(16)) };
  const priv = await importPrivate(as.d, as.pub, 'ecdh');
  const secret = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: await importPublic(uaPub, 'ecdh') }, priv, 256));
  const { cek, nonce } = await keys(secret, auth, uaPub, as.pub, as.salt);
  const body = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce as BufferSource }, cek, concat(plain, new Uint8Array([2])) as BufferSource));
  const rs = new Uint8Array([0, 0, 16, 0]); // 4096
  return concat(as.salt, rs, new Uint8Array([65]), as.pub, body);
}

/** Decrypts a push message sent to us (our private scalar and public key, and the auth secret we registered). */
export async function decryptPush(msg: Uint8Array, d: Uint8Array, uaPub: Uint8Array, auth: Uint8Array): Promise<Uint8Array> {
  if (msg.length < 86) throw new Error('bad-message');
  const salt = msg.slice(0, 16), rs = new DataView(msg.buffer, msg.byteOffset + 16, 4).getUint32(0), idlen = msg[20];
  if (idlen !== 65 || rs < 18 || msg.length - 21 - idlen > rs) throw new Error('bad-message'); // one record only
  const asPub = msg.slice(21, 21 + idlen);
  const priv = await importPrivate(d, uaPub, 'ecdh');
  const secret = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: await importPublic(asPub, 'ecdh') }, priv, 256));
  const { cek, nonce } = await keys(secret, auth, uaPub, asPub, salt);
  const padded = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce as BufferSource }, cek, msg.slice(21 + idlen) as BufferSource));
  let end = padded.length - 1;
  while (end >= 0 && padded[end] === 0) end--;
  if (end < 0 || padded[end] !== 2) throw new Error('bad-message');
  return padded.slice(0, end);
}

/** The VAPID Authorization header for a push service endpoint (RFC 8292). */
export async function vapidHeader(endpoint: string, subject: string, d: Uint8Array, pub: Uint8Array, now = Date.now()): Promise<string> {
  const aud = new URL(endpoint).origin;
  const head = b64u(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = b64u(enc.encode(JSON.stringify({ aud, exp: Math.floor(now / 1000) + 12 * 3600, sub: subject })));
  const key = await importPrivate(d, pub, 'ecdsa');
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(`${head}.${claims}`)));
  return `vapid t=${head}.${claims}.${b64u(sig)}, k=${b64u(pub)}`;
}

/**
 * Checks a VAPID Authorization header sent to us: signed by `expected` (the sender's public key, learnt when we
 * subscribed), for our origin, not expired. Accepts `vapid t=…, k=…` and the older `WebPush <jwt>` with a
 * `Crypto-Key: p256ecdsa=…` header.
 */
export async function verifyVapid(header: string | null, cryptoKey: string | null, expected: Uint8Array, audience: string, now = Date.now()): Promise<boolean> {
  if (!header) return false;
  let jwt: string | undefined, k: string | undefined;
  const v = /^vapid\s+(.+)$/i.exec(header.trim());
  if (v) for (const part of v[1].split(',')) { const [name, ...rest] = part.trim().split('='); if (name === 't') jwt = rest.join('='); if (name === 'k') k = rest.join('='); }
  else { const w = /^WebPush\s+(\S+)$/i.exec(header.trim()); jwt = w?.[1]; k = /p256ecdsa=([A-Za-z0-9_-]+)/.exec(cryptoKey ?? '')?.[1]; }
  if (!jwt || !k) return false;
  try {
    if (b64u(unb64u(k)) !== b64u(expected)) return false;
    const [h, c, s] = jwt.split('.');
    if (!h || !c || !s) return false;
    const claims = JSON.parse(new TextDecoder().decode(unb64u(c))) as { aud?: string; exp?: number };
    if (claims.aud !== audience || typeof claims.exp !== 'number' || claims.exp * 1000 < now || claims.exp * 1000 > now + 25 * 3600_000) return false;
    return await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, await importPublic(expected, 'ecdsa'), unb64u(s) as BufferSource, enc.encode(`${h}.${c}`));
  } catch { return false; }
}
