#!/usr/bin/env node
/**
 * Read-only Fedizen public OIDC discovery preflight.
 *
 * node scripts/probe-fedizen-oidc.mjs --self-test
 * node scripts/probe-fedizen-oidc.mjs
 *
 * This does NOT test login, Supabase integration, delegated user permissions,
 * or token validity. It logs only sanitized comparisons and booleans.
 */
import assert from 'node:assert/strict';

const ISSUER = 'https://fedizen.net';
const DISCOVERY = `${ISSUER}/.well-known/openid-configuration`;
const MAX_BYTES = 131_072;

function sameIssuerOrigin(value) {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return url.origin === ISSUER && url.protocol === 'https:' &&
      url.username === '' && url.password === '' && url.hash === '';
  } catch { return false; }
}

export function assess(metadata) {
  const obj = metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? metadata : {};
  const supports = (key, item) => Array.isArray(obj[key]) && obj[key].includes(item);
  const algs = Array.isArray(obj.id_token_signing_alg_values_supported)
    ? obj.id_token_signing_alg_values_supported : [];
  const methods = obj.code_challenge_methods_supported;
  return {
    issuerMatches: obj.issuer === ISSUER,
    authorizationEndpointSameOrigin: sameIssuerOrigin(obj.authorization_endpoint),
    tokenEndpointSameOrigin: sameIssuerOrigin(obj.token_endpoint),
    jwksEndpointSameOrigin: sameIssuerOrigin(obj.jwks_uri),
    supportsAuthorizationCode: supports('response_types_supported', 'code'),
    supportsAsymmetricIdTokenSigning: algs.some(x => ['RS256', 'PS256', 'ES256', 'ES384', 'EdDSA'].includes(x)),
    publishedPkceS256: methods === undefined ? 'not-advertised' : supports('code_challenge_methods_supported', 'S256'),
    publishedOpenIdScope: obj.scopes_supported === undefined ? 'not-advertised' : supports('scopes_supported', 'openid'),
  };
}

function fixture(overrides = {}) {
  return {
    issuer: ISSUER,
    authorization_endpoint: `${ISSUER}/oauth/authorize`,
    token_endpoint: `${ISSUER}/oauth/token`,
    jwks_uri: `${ISSUER}/oauth/jwks`,
    response_types_supported: ['code'],
    id_token_signing_alg_values_supported: ['RS256'],
    code_challenge_methods_supported: ['S256'],
    scopes_supported: ['openid', 'profile', 'email'],
    ...overrides,
  };
}

async function selfTest() {
  const valid = assess(fixture());
  for (const value of Object.values(valid)) assert.equal(value, true);
  assert.equal(assess(fixture({ issuer: 'https://hostile.example' })).issuerMatches, false);
  assert.equal(assess(fixture({ token_endpoint: 'https://hostile.example/token' })).tokenEndpointSameOrigin, false);
  assert.equal(assess(fixture({ jwks_uri: 'https://fedizen.net.evil.example/jwks' })).jwksEndpointSameOrigin, false);
  assert.equal(assess(fixture({ authorization_endpoint: 'http://fedizen.net/oauth' })).authorizationEndpointSameOrigin, false);
  assert.equal(assess(fixture({ response_types_supported: ['token'] })).supportsAuthorizationCode, false);
  assert.equal(assess(fixture({ id_token_signing_alg_values_supported: ['none'] })).supportsAsymmetricIdTokenSigning, false);
  assert.equal(assess(fixture({ scopes_supported: undefined })).publishedOpenIdScope, 'not-advertised');
  assert.equal(assess(fixture({ code_challenge_methods_supported: undefined })).publishedPkceS256, 'not-advertised');
  assert.equal(assess(null).issuerMatches, false);
  console.log('PASS: offline OIDC discovery contract tests');
}

async function probe() {
  const response = await fetch(DISCOVERY, {
    method: 'GET',
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(10000),
    redirect: 'error',
    cache: 'no-store',
  });
  if (!response.ok) throw Error('HTTP failure');
  const declared = response.headers.get('content-length');
  if (declared !== null && Number(declared) > MAX_BYTES) throw Error('oversize');
  if (!response.body) throw Error('missing body');
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_BYTES) throw Error('oversize');
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  const buf = new Uint8Array(total);
  let position = 0;
  for (const part of chunks) { buf.set(part, position); position += part.byteLength; }
  const result = assess(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buf)));
  console.log(JSON.stringify({ source: 'fedizen-public-oidc', ...result }));
  if (!result.issuerMatches || !result.authorizationEndpointSameOrigin ||
    !result.tokenEndpointSameOrigin || !result.jwksEndpointSameOrigin ||
    !result.supportsAuthorizationCode || !result.supportsAsymmetricIdTokenSigning) {
    process.exitCode = 1;
  }
}

if (process.argv.includes('--self-test')) await selfTest();
else {
  try { await probe(); }
  catch {
    // Never print raw discovery payloads or detailed remote exceptions.
    console.log(JSON.stringify({ source: 'fedizen-public-oidc', status: 'unavailable-or-invalid' }));
    process.exitCode = 1;
  }
}
