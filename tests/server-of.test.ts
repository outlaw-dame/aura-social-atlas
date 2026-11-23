import { describe, expect, test } from 'bun:test';
import { bareAcct, revokeSpotlightAfterServerBlock, serverOf } from '../src/components/social/useServerBlock';
import { QueryClient } from '@tanstack/react-query';

describe('the server part of a handle', () => {
  test('with or without the leading @ profiles show', () => {
    expect(serverOf('@ann@castopod.example.net')).toBe('castopod.example.net');
    expect(serverOf('ann@Castopod.Example.net')).toBe('castopod.example.net');
    expect(bareAcct('@ann@castopod.example.net')).toBe('ann@castopod.example.net');
  });
  test('none for Fedizen itself or a bare name', () => {
    expect(serverOf('@ann@fedizen.net')).toBeNull();
    expect(serverOf('ann')).toBeNull();
    expect(serverOf(undefined)).toBeNull();
  });
});

describe('server-block moderation cache isolation', () => {
  test('immediately revokes only the acting account Spotlight snapshot', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const old = { items: [{ id: 'visible-article' }], moderation: { blockedHandles: [] } };
    qc.setQueryData(['spotlight-viewer', 'owner'], old);
    qc.setQueryData(['spotlight-viewer', 'someone-else'], old);
    await revokeSpotlightAfterServerBlock(qc, 'owner');
    expect(qc.getQueryData(['spotlight-viewer', 'owner'])).toEqual({ items: [], moderation: null });
    expect(qc.getQueryData(['spotlight-viewer', 'someone-else'])).toEqual(old);
    qc.clear();
  });
});

describe('server handle validation', () => {
  test('rejects malformed DNS and ambiguous handles while supporting punycode', () => {
    for (const acct of ['@@ann@remote.example', 'ann@@remote.example', 'ann@remote.example@extra.org',
      '@ann@remote..example', '@ann@-remote.example', '@ann@remote-.example',
      '@ann@localhost', '@ann@remote.example/path', '@ann@remote.example?key=1']) {
      expect(serverOf(acct)).toBeNull();
    }
    expect(serverOf('  @ann@REMOTE.EXAMPLE  ')).toBe('remote.example');
    expect(serverOf('@ann@xn--bcher-kva.example')).toBe('xn--bcher-kva.example');
  });
});
