import { describe, expect, test } from 'bun:test';
import { b64u, decryptPush, encryptPush, newKeyPair, unb64u, vapidHeader, verifyVapid } from '../src/lib/push/webpush';

// RFC 8291, Appendix A.
const V = {
  plaintext: 'When I grow up, I want to be a watermelon',
  asPrivate: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw',
  asPublic: 'BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8',
  uaPrivate: 'q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94',
  uaPublic: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
  salt: 'DGv6ra1nlYgDCS1FRnbzlw',
  auth: 'BTBZMqHH6r4Tts7J_aSIgg',
  body: 'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN',
};

describe('Web Push encryption (RFC 8291)', () => {
  test('encrypts the RFC 8291 example to its exact bytes', async () => {
    const out = await encryptPush(new TextEncoder().encode(V.plaintext), unb64u(V.uaPublic), unb64u(V.auth), { d: unb64u(V.asPrivate), pub: unb64u(V.asPublic), salt: unb64u(V.salt) });
    expect(b64u(out)).toBe(V.body);
  });
  test('decrypts the RFC 8291 example', async () => {
    const plain = await decryptPush(unb64u(V.body), unb64u(V.uaPrivate), unb64u(V.uaPublic), unb64u(V.auth));
    expect(new TextDecoder().decode(plain)).toBe(V.plaintext);
  });
  test('round-trips with fresh keys, and refuses a tampered message', async () => {
    const ua = await newKeyPair(), auth = crypto.getRandomValues(new Uint8Array(16));
    const msg = await encryptPush(new TextEncoder().encode('{"title":"hi"}'), ua.pub, auth);
    expect(new TextDecoder().decode(await decryptPush(msg, ua.d, ua.pub, auth))).toBe('{"title":"hi"}');
    msg[msg.length - 1] ^= 1;
    await expect(decryptPush(msg, ua.d, ua.pub, auth)).rejects.toThrow();
  });
});

describe('VAPID (RFC 8292)', () => {
  test('a header we sign verifies for its audience only, and only with its key', async () => {
    const k = await newKeyPair(), other = await newKeyPair();
    const h = await vapidHeader('https://push.example.net/send/abc', 'mailto:atlas@example.org', k.d, k.pub);
    expect(h).toMatch(/^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=[\w-]+$/);
    expect(await verifyVapid(h, null, k.pub, 'https://push.example.net')).toBe(true);
    expect(await verifyVapid(h, null, k.pub, 'https://elsewhere.example')).toBe(false);
    expect(await verifyVapid(h, null, other.pub, 'https://push.example.net')).toBe(false);
    expect(await verifyVapid(h, null, k.pub, 'https://push.example.net', Date.now() + 13 * 3600_000)).toBe(false);
    expect(await verifyVapid(null, null, k.pub, 'https://push.example.net')).toBe(false);
  });
});
