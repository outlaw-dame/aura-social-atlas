#!/usr/bin/env bun
/**
 * Protected, manual-only live Spotlight acceptance for a consenting disposable
 * Fedizen account. Do not print handles, tokens, URLs, posts or provider bodies.
 * This tests the SAME strict owner moderation reader and public source
 * projection that Atlas uses, without connecting to Supabase or writing data.
 */
import { verifyFedizenReadGrant, fedizenGet } from '../src/lib/fedizen.server';
import { readSpotlightModeration } from '../src/lib/spotlight-moderation.server';
import { normalizedAccount, allowedSpotlightItem } from '../src/lib/spotlight-curation';
import { eligiblePublicSpotlightPosts } from '../src/lib/spotlight-personal.server';
import { fromFederatedLinkCards, fromFederatedVideos } from '../src/lib/spotlight';

const token = process.env.FEDIZEN_TEST_READ_TOKEN;
const expected = process.env.FEDIZEN_TEST_EXPECTED_HANDLE;
function assert(ok: unknown, stage: string): asserts ok {
  if (!ok) throw new Error(stage);
}
const duration = (start: number) => Math.round(performance.now() - start);

async function main() {
  assert(token && expected, 'missing-protected-test-grant');
  const actual = await verifyFedizenReadGrant(token);
  assert(actual && normalizedAccount(actual) === normalizedAccount(expected), 'owner-grant-mismatch');

  const policyStarted = performance.now();
  const moderation = await readSpotlightModeration(path =>
    fedizenGet(token, path, { requireCompleteModeration: true }));
  assert(moderation, 'incomplete-owner-block-mute-policy');
  const policyMs = duration(policyStarted);
  // Do not accept the empty blocked-domain list as complete. That requires a
  // verified provider-native owner endpoint (Atlas issue #239).
  assert(moderation.domainCoverage === 'unavailable', 'unexpected-domain-coverage');
  console.log(JSON.stringify({ check: 'owner-moderation', status: 'complete-account-lists', elapsedMs: policyMs, remoteDomains: 'not-authorized' }));

  const feedStarted = performance.now();
  const [local, federated] = await Promise.all([
    fedizenGet(token, '/api/v1/timelines/local?limit=20'),
    fedizenGet(token, '/api/v1/timelines/public?limit=20'),
  ]);
  assert(local.status === 200 || federated.status === 200, 'public-source-unavailable');
  const candidates = [
    ...(local.status === 200 ? eligiblePublicSpotlightPosts(local.data, moderation) : []),
    ...(federated.status === 200 ? eligiblePublicSpotlightPosts(federated.data, moderation) : []),
  ];
  const cards = [
    ...fromFederatedLinkCards(candidates),
    ...fromFederatedVideos(candidates),
  ].filter(item => allowedSpotlightItem(item, moderation));
  // This result is a diagnostic, not a fabricated trending statistic. If no
  // eligible card exists, a full visual acceptance remains unproven.
  console.log(JSON.stringify({
    check: 'owner-public-source',
    status: cards.length ? 'eligible-cards-observed' : 'no-eligible-cards',
    elapsedMs: duration(feedStarted),
    localHttp: local.status,
    federatedHttp: federated.status,
    eligiblePublicPosts: candidates.length,
    eligibleCards: cards.length,
  }));
  assert(cards.length > 0, 'no-eligible-spotlight-card-for-live-acceptance');
}

main().catch(error => {
  // Only these static, internal stage identifiers can leave the workflow.
  const allowed = new Set([
    'missing-protected-test-grant', 'owner-grant-mismatch',
    'incomplete-owner-block-mute-policy', 'unexpected-domain-coverage',
    'public-source-unavailable', 'no-eligible-spotlight-card-for-live-acceptance',
  ]);
  const stage = error instanceof Error && allowed.has(error.message)
    ? error.message : 'unavailable';
  console.error(JSON.stringify({ check: 'spotlight-acceptance', status: 'failed', stage }));
  process.exitCode = 1;
});
