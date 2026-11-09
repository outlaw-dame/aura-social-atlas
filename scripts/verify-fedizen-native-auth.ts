/**
 * Consented, read-only Bonfire-native acceptance against REAL Fedizen.
 *
 * Requires a disposable Fedizen user's delegated API grant, provisioned as a
 * protected GitHub Actions environment secret. No account data, tokens, posts,
 * author IDs, cursors or remote errors are printed or committed.
 *
 * Run: bun scripts/verify-fedizen-native-auth.ts
 * Offline: bun scripts/verify-fedizen-native-auth.ts --self-test
 *
 * This verifies the READ bearer path only; it does NOT prove Atlas OIDC login,
 * Supabase session/callback handling, other-user privacy or mutations.
 */
import { strict as assert } from 'node:assert';
import { fedizenGet, verifyFedizenReadGrant } from '../src/lib/fedizen.server';
import { readNativeBonfirePost, readNativeBonfireProfile } from '../src/lib/bonfire-detail.server';
import {
  matchesLinkedFedizenHandle,
  readNativeBonfireMe,
  readNativeBonfirePage,
  normalizeNativeBonfireHome,
  normalizeNativeBonfireNotifications, isConclusiveAnonymousMeDenial,
} from '../src/lib/bonfire-private.server';

function summarizeResult(name: string, accepted: boolean, details: Record<string, boolean | number> = {}) {
  console.log(JSON.stringify({ check: name, accepted, ...details }));
}

/**
 * The actual Fedizen REST fallback validates the nested response schema and
 * caps the response before returning. Empty lists are legitimate; HTTP 200
 * alone on an unvalidated endpoint would not be enough.
 */
export function acceptedPrivateRestRead(result: { status: number; data: unknown[] }): boolean {
  return result.status === 200 && Array.isArray(result.data) && result.data.length <= 20;
}

async function live() {
  const token = process.env['FEDIZEN_TEST_READ_TOKEN'];
  const expected = process.env['FEDIZEN_TEST_EXPECTED_HANDLE'];
  if (!token || !expected || token.length > 8192 || expected.length > 320) {
    throw Error('Required consented test configuration is not available.');
  }

  const restHandle = await verifyFedizenReadGrant(token);
  const restIdentityOK = !!restHandle && matchesLinkedFedizenHandle(expected, restHandle);
  summarizeResult('delegated-rest-owner', restIdentityOK);
  if (!restIdentityOK) throw Error('Test bearer does not match the explicitly expected account.');

  const [restHome, restNotifications] = await Promise.all([
    fedizenGet(token, '/api/v1/timelines/home?limit=20'),
    fedizenGet(token, '/api/v1/notifications?limit=20'),
  ]);
  const restHomeOK = acceptedPrivateRestRead(restHome);
  const restNotificationsOK = acceptedPrivateRestRead(restNotifications);
  summarizeResult('mastodon-rest-home-owner', restHomeOK);
  summarizeResult('mastodon-rest-notifications-owner', restNotificationsOK);
  if (!restHomeOK || !restNotificationsOK) {
    throw Error('Delegated read grant could not access validated REST Home and notifications.');
  }

  const me = await readNativeBonfireMe(token);
  const nativeIdentityOK = !!me?.user?.character?.username &&
    matchesLinkedFedizenHandle(restHandle, me.user.character.username) &&
    matchesLinkedFedizenHandle(expected, me.user.character.username);
  summarizeResult('graphql-me-owner', !!nativeIdentityOK);
  if (!nativeIdentityOK) throw Error('Native GraphQL owner identity did not match the REST grant.');

  // Consent-bound own profile acceptance. The IDs are read in memory from
  // native Me, and never printed or sent to any destination except Fedizen.
  const byId = await readNativeBonfireProfile(token, { by: 'id', value: me.user.id });
  const ownProfileByIdOK = !!byId && byId.id === me.user.id &&
    matchesLinkedFedizenHandle(restHandle, byId.character?.username);
  summarizeResult('graphql-profile-by-id-owner', ownProfileByIdOK);
  if (!ownProfileByIdOK) throw Error('GraphQL own profile by ID did not match the verified account.');

  const byUsername = await readNativeBonfireProfile(token, {
    by: 'username', value: me.user.character.username,
  });
  const ownProfileByUsernameOK = !!byUsername && byUsername.id === me.user.id &&
    matchesLinkedFedizenHandle(restHandle, byUsername.character?.username);
  summarizeResult('graphql-profile-by-username-owner', ownProfileByUsernameOK);
  if (!ownProfileByUsernameOK) throw Error('GraphQL own profile by username did not match the verified account.');

  // A post lookup can only be tested when the consenting operator supplies
  // an explicitly known disposable test post. Never infer a private post ID
  // from a third party's activity, and never mark an absent test as passed.
  const disposablePostId = process.env['FEDIZEN_TEST_POST_ID'];
  if (disposablePostId) {
    const detail = await readNativeBonfirePost(token, disposablePostId);
    const postOK = !!detail && detail.id === disposablePostId;
    summarizeResult('graphql-consented-post-detail', postOK);
    if (!postOK) throw Error('Consented GraphQL post detail was not resolved.');
  } else {
    console.log(JSON.stringify({ check: 'graphql-consented-post-detail', accepted: false, status: 'not-configured' }));
  }

  const home = await readNativeBonfirePage(token, 'myFeed');
  if (!home) throw Error('GraphQL Me.myFeed did not identify an authorized account.');
  const posts = normalizeNativeBonfireHome(home).posts;
  if (!Array.isArray(posts)) throw Error('Unexpected native Home projection.');
  const homePageConsistent = !home.pageInfo.hasNextPage || !!home.pageInfo.endCursor;
  summarizeResult('graphql-my-feed', homePageConsistent);
  if (!homePageConsistent) throw Error('Home pagination metadata is inconsistent.');

  const notices = await readNativeBonfirePage(token, 'notifications');
  if (!notices) throw Error('GraphQL Me.notifications did not identify an authorized account.');
  const normalizedNotices = normalizeNativeBonfireNotifications(notices).notices;
  if (!Array.isArray(normalizedNotices)) throw Error('Unexpected native notifications projection.');
  const notificationPageConsistent = !notices.pageInfo.hasNextPage || !!notices.pageInfo.endCursor;
  summarizeResult('graphql-notifications', notificationPageConsistent);
  if (!notificationPageConsistent) throw Error('Notification pagination metadata is inconsistent.');

  if (home.pageInfo.hasNextPage && home.pageInfo.endCursor) {
    const second = await readNativeBonfirePage(token, 'myFeed', home.pageInfo.endCursor);
    const secondPageOK = !!second && Array.isArray(second.nodes);
    summarizeResult('graphql-home-cursor', secondPageOK);
    if (!secondPageOK) throw Error('Home cursor page was not accepted.');
  }

  // Anonymous read MUST NOT resolve the authenticated test identity. A GraphQL
  // permission error is an acceptable denial, as is me:null.
  let anonymousDenied = false;
  try {
    const anonymousMe = await readNativeBonfireMe('');
    anonymousDenied = isConclusiveAnonymousMeDenial(anonymousMe);
  } catch (error) {
    anonymousDenied = isConclusiveAnonymousMeDenial(undefined, error);
  }
  summarizeResult('graphql-anonymous-owner-denied', anonymousDenied);
  if (!anonymousDenied) throw Error('Anonymous GraphQL unexpectedly exposed a signed-in identity.');

  console.log('PASS: configured consented native and Mastodon REST read acceptance checks (unconfigured optional checks are not accepted)');
}

function selfTest() {
  assert.equal(matchesLinkedFedizenHandle('atlas-test@fedizen.net', 'atlas-test'), true);
  assert.equal(matchesLinkedFedizenHandle('other@fedizen.net', 'atlas-test'), false);
  assert.equal(matchesLinkedFedizenHandle('atlas-test@lookalike.invalid', 'atlas-test'), false);
  assert.equal(matchesLinkedFedizenHandle(null, 'atlas-test'), false);
  assert.equal(acceptedPrivateRestRead({ status: 200, data: [] }), true);
  assert.equal(acceptedPrivateRestRead({ status: 200, data: [{ id: 'private', content: 'not-logged' }] }), true);
  assert.equal(acceptedPrivateRestRead({ status: 401, data: [] }), false);
  assert.equal(acceptedPrivateRestRead({ status: 502, data: [] }), false);
  assert.equal(acceptedPrivateRestRead({ status: 503, data: [] }), false);
  console.log('PASS: offline native read acceptance preflight');
}

if (process.argv.includes('--self-test')) {
  selfTest();
} else {
  try { await live(); }
  catch {
    // Deliberately suppress private upstream error messages, actor identities,
    // token values, URLs with authorization info and content.
    console.error('FAIL: consented Fedizen native read acceptance');
    process.exitCode = 1;
  }
}
