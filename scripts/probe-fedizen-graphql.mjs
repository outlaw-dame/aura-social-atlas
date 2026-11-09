#!/usr/bin/env node
/**
 * Phase A: anonymous, read-only Fedizen GraphQL contract probe.
 *
 * Run: node scripts/probe-fedizen-graphql.mjs
 * Run offline tests: node scripts/probe-fedizen-graphql.mjs --self-test
 *
 * No credentials, introspection, user-specific queries, automatic retries,
 * persisted response bodies, or environment-driven arbitrary URLs.
 * The output is deliberately metadata-only. A successful HTTP status is not
 * proof that the schema fields exist or that authorization works.
 */
import assert from 'node:assert/strict';

const ENDPOINT = 'https://fedizen.net/api/graphql';
const TIMEOUT_MS = 10000;
const MAX_RESPONSE_BYTES = 512_000;
const FEEDS = ['local', 'articles'];
const OPERATION = `query AtlasPublicFeedContract($name: String!) {
  feedActivities(first: 1, filter: { feedName: $name }) {
    edges { node { id } }
  }
}`;

export function summarize(status, payload) {
  const result = {
    httpStatus: status,
    graphqlData: 'missing',
    feedActivities: 'missing',
    edges: null,
    errors: [],
  };
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    result.graphqlData = 'invalid-envelope';
    return result;
  }
  if (Object.hasOwn(payload, 'data')) {
    result.graphqlData = payload.data === null ? 'null' : typeof payload.data === 'object' && !Array.isArray(payload.data) ? 'object' : 'invalid';
    const feed = payload.data?.feedActivities;
    if (feed === null) result.feedActivities = 'null';
    else if (feed && typeof feed === 'object' && !Array.isArray(feed)) {
      result.feedActivities = 'object';
      if (Array.isArray(feed.edges)) result.edges = feed.edges.length;
    }
  }
  if (Array.isArray(payload.errors)) {
    // GraphQL error messages/paths may disclose data. Never emit them.
    result.errors = payload.errors.map(error => ({
      code: typeof error?.extensions?.code === 'string'
        && /^[A-Z_]{1,48}$/.test(error.extensions.code)
        ? error.extensions.code : 'UNSPECIFIED',
    })).slice(0, 10);
    result.errorCount = payload.errors.length;
  } else if (Object.hasOwn(payload, 'errors')) {
    result.errors = [{ code: 'INVALID_ERRORS_SHAPE' }];
  }
  return result;
}

async function probe(name, fetcher = fetch) {
  const response = await fetcher(ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ query: OPERATION, variables: { name } }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
    redirect: 'error',
    cache: 'no-store',
  });
  const sizeHeader = Number(response.headers?.get('content-length'));
  if (Number.isFinite(sizeHeader) && sizeHeader > MAX_RESPONSE_BYTES) {
    throw new Error('GraphQL response exceeds size limit');
  }
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength > MAX_RESPONSE_BYTES) throw new Error('GraphQL response exceeds size limit');
  let payload;
  try { payload = JSON.parse(new TextDecoder().decode(bytes)); }
  catch { return { httpStatus: response.status, graphqlData: 'invalid-json', feedActivities: 'missing', edges: null, errors: [] }; }
  return summarize(response.status, payload);
}

async function selfTest() {
  assert.deepEqual(summarize(200, { data: { feedActivities: { edges: [{ node: { id: 'private' } }] } } }), {
    httpStatus: 200, graphqlData: 'object', feedActivities: 'object', edges: 1, errors: [],
  });
  assert.deepEqual(summarize(200, { errors: [{ message: 'secret', extensions: { code: 'UNAUTHENTICATED' }, path: ['secret'] }] }).errors, [{ code: 'UNAUTHENTICATED' }]);
  assert.equal(summarize(200, { data: { feedActivities: null } }).feedActivities, 'null');
  assert.equal(summarize(200, { data: null }).graphqlData, 'null');
  assert.equal(summarize(200, []).graphqlData, 'invalid-envelope');
  assert.equal(summarize(200, { errors: [{ extensions: { code: 'password=secret' } }] }).errors[0].code, 'UNSPECIFIED');
  const fake = async (url, options) => {
    assert.equal(url, ENDPOINT);
    assert.equal(options.method, 'POST');
    assert.equal(options.redirect, 'error');
    assert.deepEqual(JSON.parse(options.body).variables, { name: 'local' });
    return { status: 200, headers: { get: () => null }, arrayBuffer: async () => new TextEncoder().encode(JSON.stringify({ data: { feedActivities: { edges: [] } } })).buffer };
  };
  assert.equal((await probe('local', fake)).edges, 0);
  const huge = async () => ({ status: 200, headers: { get: () => String(MAX_RESPONSE_BYTES + 1) } });
  await assert.rejects(probe('local', huge), /size limit/);
  console.log('PASS: offline contract probe tests');
}

async function main() {
  if (process.argv.includes('--self-test')) return selfTest();
  let failures = 0;
  for (const name of FEEDS) {
    try {
      const output = await probe(name);
      console.log(JSON.stringify({ endpoint: ENDPOINT, feedName: name, ...output }));
      if (output.httpStatus !== 200 || output.graphqlData !== 'object'
          || output.feedActivities !== 'object' || output.edges === null || output.errors.length) failures++;
    } catch (error) {
      failures++;
      // Do not print raw network errors: upstream strings can contain request metadata.
      console.log(JSON.stringify({ endpoint: ENDPOINT, feedName: name, status: 'transport-failure', category: error?.name === 'TimeoutError' ? 'timeout' : 'network-or-protocol' }));
    }
  }
  if (failures) process.exitCode = 1;
}
await main();
