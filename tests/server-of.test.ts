import { describe, expect, test } from 'bun:test';
import { bareAcct, revokeSpotlightAfterServerBlock, serverOf } from '../src/components/social/useServerBlock';
import { QueryClient } from '@tanstack/react-query';

describe('the server part of a handle', () => {
  test('with or without the leading @ profiles show', () => {
    expect(serverOf('@ann@castopod.example.net')).toBe('castopod.example.net');
    expect(serverOf('ann@Castopod.Example.net')).toBe('castopod.example.net');
    expect(bareAcct('@ann@castopod.example.net')).toBe('ann@castopod.example.net');
  });
  test('rejects malformed multi-at, invalid domains and confusing lookalike targets', () => {
    for (const acct of ['@@ann@remote.example', 'ann@@remote.example', 'ann@remote.example@other.com',
      '@ann@remote..example', '@ann@-remote.example', '@ann@remote-.example',
      '@ann@localhost', '@ann@remote.example/path', '@ann@remote.example?x=1',
      '@ann@fedizen.net', '@ann']) {
      expect(serverOf(acct)).toBeNull();
    }
    expect(serverOf('  @ann@Remote.Example  ')).toBe('remote.example');
    expect(serverOf('@ann@xn--bcher-kva.example')).toBe('xn--bcher-kva.example');
  });

  test('none for Fedizen itself or a bare name', () => {
    expect(serverOf('@ann@fedizen.net')).toBeNull();
    expect(serverOf('ann')).toBeNull();
    expect(serverOf(undefined)).toBeNull();
  });
});

describe('Spotlight policy invalidation after a server block operation', () => {
  test('withholds the acting account immediately and never touches another account', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const old = { items: [{ id: 'old-remote-story' }], moderation: { blockedHandles: [] } };
    qc.setQueryData(['spotlight-viewer', 'account-A'], old);
    qc.setQueryData(['spotlight-viewer', 'account-B'], old);
    await revokeSpotlightAfterServerBlock(qc, 'account-A');
    expect(qc.getQueryData(['spotlight-viewer', 'account-A'])).toEqual({ items: [], moderation: null });
    expect(qc.getQueryData(['spotlight-viewer', 'account-B'])).toEqual(old);
    qc.clear();
  });
});
