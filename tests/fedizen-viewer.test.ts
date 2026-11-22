import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { avatarFromVerifiedFedizenActor, parseFedizenViewer, signedInThroughFedizen } from '../src/lib/fedizen-viewer';
import { readVerifiedFedizenViewer, verifyFedizenReadGrant } from '../src/lib/fedizen.server';

const account = {
  id: '01ABCDE', acct: 'reader', username: 'reader',
  display_name: 'Real Fedizen Name',
  avatar: 'https://fedizen.net/uploads/real-avatar.png',
  header: 'https://fedizen.net/uploads/cover.webp',
  url: 'https://fedizen.net/@reader',
  followers_count: 42, following_count: 17, statuses_count: 9,
};

describe('verified social identity presentation', () => {
  test('displays the actual owner avatar, name, canonical handle and real API counts', () => {
    expect(parseFedizenViewer(account)).toEqual({
      handle: '@reader@fedizen.net',
      name: 'Real Fedizen Name',
      avatar: 'https://fedizen.net/uploads/real-avatar.png',
      header: 'https://fedizen.net/uploads/cover.webp',
      profileUrl: 'https://fedizen.net/@reader',
      followers: 42, following: 17, posts: 9,
    });
  });

  test('no avatar fallback can masquerade as the actual connected Fedizen avatar', () => {
    const viewer = parseFedizenViewer({ ...account, avatar: 'https://fedizen.net/images/avatar.png' });
    expect(viewer?.avatar).toBeNull();
    expect(parseFedizenViewer({ ...account, avatar: 'http://fedizen.net/unsafe.png' })?.avatar).toBeNull();
    expect(parseFedizenViewer({ ...account, avatar: 'https://localhost/unsafe.png' })?.avatar).toBeNull();
    expect(parseFedizenViewer({ ...account, avatar: 'https://user:secret@fedizen.net/a.png' })?.avatar).toBeNull();
    expect(parseFedizenViewer({ ...account, avatar: 'javascript:alert(1)' })?.avatar).toBeNull();
  });

  test('Bonfire placeholder falls back only to the same verified ActivityPub actor', () => {
    const viewer = parseFedizenViewer({ ...account, avatar: 'https://fedizen.net/images/avatar.png' })!;
    const actor = {
      id: 'https://fedizen.net/actors/reader', preferredUsername: 'reader',
      icon: { url: 'https://cdn.example.org/real-avatar.webp' },
    };
    expect(avatarFromVerifiedFedizenActor(viewer, actor)).toBe('https://cdn.example.org/real-avatar.webp');
    expect(avatarFromVerifiedFedizenActor(viewer, { ...actor, preferredUsername: 'another-reader' })).toBeNull();
    expect(avatarFromVerifiedFedizenActor(viewer, { ...actor, id: 'https://example.org/actors/reader' })).toBeNull();
    expect(avatarFromVerifiedFedizenActor(viewer, { ...actor, icon: 'http://localhost/steal' })).toBeNull();
    expect(avatarFromVerifiedFedizenActor(viewer, { ...actor, icon: { url: 'https://fedizen.net/images/avatar.png' } })).toBeNull();
    expect(avatarFromVerifiedFedizenActor({ ...viewer, profileUrl: null }, actor)).toBeNull();
  });

  test('never misrepresents unavailable statistics as zero', () => {
    const viewer = parseFedizenViewer({ ...account, display_name: '', followers_count: undefined, following_count: -1, statuses_count: '12' });
    expect(viewer?.name).toBe('reader');
    expect(viewer?.followers).toBeNull();
    expect(viewer?.following).toBeNull();
    expect(viewer?.posts).toBeNull();
  });

  test('rejects malformed accounts, off-server handles and unrelated URLs', () => {
    expect(parseFedizenViewer(null)).toBeNull();
    expect(parseFedizenViewer({ ...account, id: null })).toBeNull();
    expect(parseFedizenViewer({ ...account, acct: 'evil@example.org' })).toBeNull();
    expect(parseFedizenViewer({ ...account, url: 'https://example.org/not-fedizen' })?.profileUrl).toBeNull();
    expect(parseFedizenViewer({ ...account, acct: '@reader@fedizen.net' })?.handle).toBe('@reader@fedizen.net');
  });

  test('Fedizen OIDC logins do not receive a generated local avatar as social identity', () => {
    expect(signedInThroughFedizen({ app_metadata: { provider: 'custom:app-oidc' } })).toBe(true);
    expect(signedInThroughFedizen({ identities: [{ provider: 'custom:app-oidc' }] })).toBe(true);
    expect(signedInThroughFedizen({ app_metadata: { providers: ['email', 'custom:app-oidc'] } })).toBe(true);
    expect(signedInThroughFedizen({ app_metadata: { provider: 'email' } })).toBe(false);
    expect(signedInThroughFedizen(null)).toBe(false);
  });

  test('real viewer transport uses fixed verified credential path and rejects upstream failures', async () => {
    let verifiedUrl = '';
    let verifiedAuth = '';
    const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
      verifiedUrl = String(input);
      verifiedAuth = new Headers(init?.headers).get('authorization') || '';
      return new Response(JSON.stringify(account), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch;
    const profile = await readVerifiedFedizenViewer('dummy-test-token', fetcher);
    expect(profile?.avatar).toBe(account.avatar);
    expect(verifiedUrl).toBe('https://fedizen.net/api/v1/accounts/verify_credentials');
    expect(verifiedAuth).toBe('Bearer dummy-test-token');
    expect(await verifyFedizenReadGrant('dummy-test-token', fetcher)).toBe('reader');

    const failed = (async () => new Response('{}', { status: 401 })) as typeof fetch;
    expect(await readVerifiedFedizenViewer('dummy-test-token', failed)).toBeNull();
    expect(await verifyFedizenReadGrant('dummy-test-token', failed)).toBeNull();
  });

  test('all owner views use the verified profile source and server checks the stored connection owner', () => {
    const server = readFileSync('src/lib/fedizen.functions.ts', 'utf8');
    expect(server).toContain('getFedizenViewer');
    expect(server).toContain('matchesLinkedFedizenHandle(connected.account_handle, viewer.handle)');
    const files = [
      'src/components/social/ProfilePage.tsx',
      'src/components/f7/ProfileView.tsx',
      'src/components/social/AccountButton.tsx',
      'src/components/social/Discovery.tsx',
      'src/components/f7/AtlasMobileApp.tsx',
    ];
    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      expect(source).toContain('useFedizenIdentity');
    }
  });

  test('disconnect cancels and clears the verified identity cache before showing another account', () => {
    const source = readFileSync('src/components/social/useFedizen.ts', 'utf8');
    expect(source).toContain("qc.cancelQueries({ queryKey: ['fedizen-viewer', id], exact: true })");
    expect(source).toContain("qc.setQueryData(['fedizen-viewer', id], { connected: false, viewer: null })");
  });
});
