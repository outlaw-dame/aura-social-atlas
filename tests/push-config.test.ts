import { afterEach, describe, expect, test } from 'bun:test';
import { vapidConfig, vapidKeysMatch } from '../src/lib/push/relay.server';
import { b64u, newKeyPair } from '../src/lib/push/webpush';

const saved = { ...process.env };
afterEach(() => { for (const k of ['ATLAS_VAPID_PUBLIC_KEY', 'ATLAS_VAPID_PRIVATE_KEY', 'ATLAS_VAPID_SUBJECT']) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } });
const set = (pub: string, d: string, subject = 'mailto:push@atlas-social.space') => { process.env['ATLAS_VAPID_PUBLIC_KEY'] = pub; process.env['ATLAS_VAPID_PRIVATE_KEY'] = d; process.env['ATLAS_VAPID_SUBJECT'] = subject; };

describe('VAPID secrets as people paste them', () => {
  test('a fresh pair is accepted, and is a pair', async () => {
    const k = await newKeyPair(); set(b64u(k.pub), b64u(k.d));
    const v = vapidConfig();
    expect('problem' in v).toBe(false);
    expect(await vapidKeysMatch(v as never)).toBe(true);
  });
  test('a pasted "NAME=value" line, quotes, spaces and standard base64 still work', async () => {
    const k = await newKeyPair();
    const std = (b: Uint8Array) => btoa(String.fromCharCode(...b));
    set(` "ATLAS_VAPID_PUBLIC_KEY=${b64u(k.pub)}" `, `ATLAS_VAPID_PRIVATE_KEY=${std(k.d)}\n`);
    const v = vapidConfig();
    expect('problem' in v).toBe(false);
    expect(await vapidKeysMatch(v as never)).toBe(true);
  });
  test('a private key missing its leading zero byte is restored', async () => {
    let k = await newKeyPair();
    while (k.d[0] !== 0) k = await newKeyPair(); // 1 in 256
    set(b64u(k.pub), b64u(k.d.slice(1)));
    const v = vapidConfig();
    expect('problem' in v).toBe(false);
    expect(await vapidKeysMatch(v as never)).toBe(true);
  });
  test('says which part is wrong, never the value', async () => {
    const a = await newKeyPair(), b = await newKeyPair();
    delete process.env['ATLAS_VAPID_PUBLIC_KEY'];
    expect(vapidConfig()).toEqual({ problem: 'missing' });
    set(b64u(a.pub), b64u(a.d), 'push@atlas-social.space');
    expect(vapidConfig()).toEqual({ problem: 'bad-subject' });
    set('not-a-key', b64u(a.d));
    expect(vapidConfig()).toEqual({ problem: 'bad-public-key' });
    set(b64u(a.pub), 'short');
    expect(vapidConfig()).toEqual({ problem: 'bad-private-key' });
    set(b64u(a.pub), b64u(b.d));
    expect(await vapidKeysMatch(vapidConfig() as never)).toBe(false);
  });
});
