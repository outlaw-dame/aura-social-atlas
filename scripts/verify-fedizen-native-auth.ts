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
import { verifyFedizenReadGrant } from '../src/lib/fedizen.server';
import {
  matchesLinkedFedizenHandle,
  readNativeBonfireMe,
  readNativeBonfirePage,
  normalizeNativeBonfireHome,
  normalizeNativeBonfireNotifications,
} from '../src/lib/bonfire-private.server';

function summarizeResult(name: string, accepted: boolean, details: Record<string, boolean | number> = {}) {
  console.log(JSON.stringify({ check: name, accepted, ...details }));
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

  const me = await readNativeBonfireMe(token);
  const nativeIdentityOK = !!me?.user?.character?.username &&
    matchesLinkedFedizenHandle(restHandle, me.user.character.username) &&
    matchesLinkedFedizenHandle(expected, me.user.character.username);
  summarizeResult('graphql-me-owner', !!nativeIdentityOK);
  if (!nativeIdentityOK) throw Error('Native GraphQL owner identity did not match the REST grant.');

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
  let anonymousDenied = true;
  try {
    const anonymousMe = await readNativeBonfireMe('');
    anonymousDenied = anonymousMe === null || anonymousMe.user === null;
  } catch {
    anonymousDenied = true;
  }
  summarizeResult('graphql-anonymous-owner-denied', anonymousDenied);
  if (!anonymousDenied) throw Error('Anonymous GraphQL unexpectedly exposed a signed-in identity.');

  console.log('PASS: consented native read acceptance (no private content logged)');
}

function selfTest() {
  assert.equal(matchesLinkedFedizenHandle('atlas-test@fedizen.net', 'atlas-test'), true);
  assert.equal(matchesLinkedFedizenHandle('other@fedizen.net', 'atlas-test'), false);
  assert.equal(matchesLinkedFedizenHandle('atlas-test@lookalike.invalid', 'atlas-test'), false);
  assert.equal(matchesLinkedFedizenHandle(null, 'atlas-test'), false);
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
