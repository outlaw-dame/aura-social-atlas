import { describe, expect, test } from 'bun:test';
import { bareAcct, serverOf } from '../src/components/social/useServerBlock';

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
