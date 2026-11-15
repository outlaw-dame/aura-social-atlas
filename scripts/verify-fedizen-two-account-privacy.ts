/**
 * Protected, consented two-account privacy acceptance against Fedizen.
 *
 * Account A must own a disposable, deliberately non-public test post.
 * Account B must be a distinct consenting user NOT allowed to see that post.
 * Never run against genuine user content, never write, never print identities,
 * post IDs, raw API results, GraphQL errors, passwords, tokens or cursors.
 *
 * Offline: bun scripts/verify-fedizen-two-account-privacy.ts --self-test
 * Live:    bun scripts/verify-fedizen-two-account-privacy.ts
 */
import { strict as assert } from 'node:assert';
import { verifyFedizenReadGrant } from '../src/lib/fedizen.server';
import { BonfireGraphQLError } from '../src/lib/bonfire-graphql.server';
import { bonfireDetailIDSchema } from '../src/lib/bonfire-detail-contract';
import { readNativeBonfirePost, readNativeBonfireProfile, type NativeBonfirePostDetail } from '../src/lib/bonfire-detail.server';
import { matchesLinkedFedizenHandle, readNativeBonfireMe } from '../src/lib/bonfire-private.server';

export function conclusiveOtherAccountDenial(
  result: NativeBonfirePostDetail | null | undefined,
  error?: unknown,
): boolean {
  if (error !== undefined) {
    // A valid B grant and an A-readable private fixture are checked first.
    // 401, 5xx, transport errors and generic GraphQL messages are NOT proof
    // of boundary enforcement. 403/404 may intentionally hide the object.
    return error instanceof BonfireGraphQLError && error.kind === 'http' &&
      (error.status === 403 || error.status === 404);
  }
  return result === null;
}

function report(check: string, accepted: boolean) {
  console.log(JSON.stringify({ check, accepted }));
}

async function resolveOwner(token: string, expectedHandle: string) {
  const restHandle = await verifyFedizenReadGrant(token);
  const restAccepted = !!restHandle && matchesLinkedFedizenHandle(expectedHandle, restHandle);
  if (!restAccepted) throw new Error('Owner bearer/expected handle verification failed');

  const me = await readNativeBonfireMe(token);
  if (!me?.user?.id || !me.user.character?.username ||
    !matchesLinkedFedizenHandle(restHandle, me.user.character.username)) {
    throw new Error('Native GraphQL owner identity mismatch');
  }
  const profile = await readNativeBonfireProfile(token, { by: 'id', value: me.user.id });
  if (!profile || profile.id !== me.user.id ||
    !matchesLinkedFedizenHandle(restHandle, profile.character?.username)) {
    throw new Error('Owner cannot read their own validated Bonfire profile');
  }
  return { id: me.user.id, restHandle };
}

// Fixed diagnostic labels only: never include account values, post IDs or errors.
let activeCheck = 'configuration';

async function live() {
  const aToken = process.env['FEDIZEN_TEST_READ_TOKEN'];
  const aExpected = process.env['FEDIZEN_TEST_EXPECTED_HANDLE'];
  const bToken = process.env['FEDIZEN_TEST_SECOND_READ_TOKEN'];
  const bExpected = process.env['FEDIZEN_TEST_SECOND_EXPECTED_HANDLE'];
  const rawPostId = process.env['FEDIZEN_TEST_PRIVATE_POST_ID'];
  if (!aToken || !aExpected || !bToken || !bExpected || !rawPostId ||
    aToken.length > 8192 || bToken.length > 8192 ||
    aExpected.length > 320 || bExpected.length > 320) {
    throw new Error('Required protected disposable-account configuration is absent');
  }
  const privatePostId = bonfireDetailIDSchema.parse(rawPostId);
  if (aToken === bToken || matchesLinkedFedizenHandle(aExpected, bExpected)) {
    throw new Error('Test requires two distinct consenting accounts');
  }

  activeCheck = 'resolve-both-consented-owners';
  const [a, b] = await Promise.all([
    resolveOwner(aToken, aExpected),
    resolveOwner(bToken, bExpected),
  ]);
  activeCheck = 'distinct-verified-owner-identities';
  const distinctOwners = a.id !== b.id &&
    !matchesLinkedFedizenHandle(a.restHandle, b.restHandle);
  report('distinct-verified-owner-identities', distinctOwners);
  if (!distinctOwners) throw new Error('Test accounts resolved to the same Bonfire user');

  // Prove the object exists for its authorized owner before any denial check.
  activeCheck = 'private-fixture-owner-readable';
  const aPost = await readNativeBonfirePost(aToken, privatePostId);
  const ownerCanRead = !!aPost && aPost.id === privatePostId;
  report('private-fixture-owner-readable', ownerCanRead);
  if (!ownerCanRead) throw new Error('Owner could not read the explicit private fixture');

  activeCheck = 'private-fixture-other-owner-denied';
  let denied = false;
  try {
    const otherResult = await readNativeBonfirePost(bToken, privatePostId);
    denied = conclusiveOtherAccountDenial(otherResult);
  } catch (error) {
    denied = conclusiveOtherAccountDenial(undefined, error);
  }
  report('private-fixture-other-owner-denied', denied);
  if (!denied) throw new Error('Second owner access was exposed or inconclusive');

  // A non-public fixture must not resolve anonymously either. A generic
  // GraphQL error, timeout, rate-limit or transport failure is inconclusive:
  // only a validated null object or explicit HTTP 403/404 is accepted.
  activeCheck = 'private-fixture-anonymous-denied';
  let anonymousDenied = false;
  try {
    const anonymousResult = await readNativeBonfirePost('', privatePostId);
    anonymousDenied = conclusiveOtherAccountDenial(anonymousResult);
  } catch (error) {
    anonymousDenied = conclusiveOtherAccountDenial(undefined, error);
  }
  report('private-fixture-anonymous-denied', anonymousDenied);
  if (!anonymousDenied) throw new Error('Anonymous access was exposed or inconclusive');

  console.log('PASS: consented A/B and anonymous private post read boundary');
}

function selfTest() {
  assert.equal(conclusiveOtherAccountDenial(null), true);
  assert.equal(conclusiveOtherAccountDenial(undefined), false);
  assert.equal(conclusiveOtherAccountDenial({
    id: 'private-id', title: null, summary: null, paragraphs: [],
    creator: null, activity: null,
  }), false);
  for (const status of [403, 404]) {
    assert.equal(conclusiveOtherAccountDenial(undefined, new BonfireGraphQLError('http', status)), true);
  }
  for (const status of [200, 401, 429, 500, 503]) {
    assert.equal(conclusiveOtherAccountDenial(undefined, new BonfireGraphQLError('http', status)), false);
  }
  for (const kind of ['graphql', 'network', 'invalid-response'] as const) {
    assert.equal(conclusiveOtherAccountDenial(undefined, new BonfireGraphQLError(kind)), false);
  }
  assert.equal(conclusiveOtherAccountDenial(undefined, new Error('permission denied')), false);
  assert.equal(matchesLinkedFedizenHandle('a@fedizen.net', 'b@fedizen.net'), false);
  assert.equal(matchesLinkedFedizenHandle('a@fedizen.net', 'a'), true);
  console.log('PASS: offline A/B privacy acceptance classification');
}

if (process.argv.includes('--self-test')) selfTest();
else {
  try { await live(); }
  catch {
    // Never print private upstream errors, accounts or test identifiers.
    console.error(`FAIL: protected Fedizen A/B privacy acceptance at ${activeCheck}`);
    process.exitCode = 1;
  }
}
