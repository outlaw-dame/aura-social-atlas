/** Disposable CI-only backup seed and read-only restore attestation. Never run on a live database. */
import postgres from 'postgres';
import { generateCryptoKeyPair, exportJwk, importJwk } from '@fedify/fedify';
import { insertItem, loadKeyPair, saveKeyPair, queryItems } from './db.ts';

const mode = process.argv[2];
if (mode !== 'seed' && mode !== 'verify') throw new Error('Expected seed or verify');
const source = process.env.GATEWAY_TEST_DATABASE_URL;
const restored = process.env.GATEWAY_RESTORE_DATABASE_URL;
if (!source || (mode === 'verify' && !restored)) {
  throw new Error('CI disposable PostgreSQL URLs are mandatory');
}
const url = mode === 'seed' ? source : restored!;
const sql = postgres(url, { max: 2, connect_timeout: 5 });
const keyId = 'ci-pgdump-restore-rehearsal';
const itemId = 'https://ci-restore.example/items/backup-snapshot';

try {
  if (mode === 'seed') {
    const pair = await generateCryptoKeyPair('RSASSA-PKCS1-v1_5');
    const privateJwk = await exportJwk(pair.privateKey);
    const publicJwk = await exportJwk(pair.publicKey);
    await saveKeyPair(sql, keyId, privateJwk, publicJwk);
    await insertItem(sql, {
      id: itemId,
      activityId: 'https://ci-restore.example/activities/backup-snapshot',
      relayActor: 'https://ci-relay.example/actor',
      authorId: 'https://ci-restore.example/actor',
      authorName: null, authorHandle: null, authorUrl: null,
      objectOrigin: 'https://ci-restore.example',
      url: itemId, summary: null, text: 'Synthetic database restore rehearsal',
      hashtags: ['restore'], publishedAt: new Date().toISOString(),
    });
  }

  const keys = await loadKeyPair(sql, keyId);
  if (!keys) throw new Error('Signing key missing from ' + mode);
  const privateKey = await importJwk(keys.privateKey as JsonWebKey, 'private');
  const publicKey = await importJwk(keys.publicKey as JsonWebKey, 'public');
  const message = new TextEncoder().encode('CI database backup restore signature verification');
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', privateKey, message);
  if (!await crypto.subtle.verify('RSASSA-PKCS1-v1_5', publicKey, signature, message)) {
    throw new Error('Signing key failed cryptographic round trip');
  }
  const items = await queryItems(sql, { limit: 50, domain: 'ci-restore.example' });
  if (!items.items.some(item => item.id === itemId)) {
    throw new Error('Provenance-bearing synthetic item missing from backup copy');
  }
  const tables = await sql<{ tablename: string }[]>`
    SELECT tablename FROM pg_catalog.pg_tables
    WHERE schemaname = 'public' AND tablename LIKE 'gateway_%'
    ORDER BY tablename`;
  for (const expected of ['gateway_keys', 'gateway_items', 'gateway_subscriptions', 'gateway_seen']) {
    if (!tables.some(t => t.tablename === expected)) {
      throw new Error('Missing gateway table in ' + mode + ': ' + expected);
    }
  }
  const publicFingerprint = await crypto.subtle.digest(
    'SHA-256', new TextEncoder().encode(JSON.stringify(keys.publicKey)));
  const hex = Array.from(new Uint8Array(publicFingerprint), byte => byte.toString(16).padStart(2,'0')).join('');
  console.log(JSON.stringify({ event: 'database.restore_fixture', mode,
    publicKeyFingerprintSha256: hex, verifiedSignature: true,
    restoredItem: true, gatewayTables: tables.length }));
} finally {
  await sql.end({ timeout: 5 });
}
